import { GoogleGenAI, Modality, Type, type FunctionDeclaration, type LiveServerMessage } from '@google/genai';
import type { WebSocket, WebSocketServer } from 'ws';
import { verifyFirebaseToken } from './auth.js';
import { HealthProfileConfirmationGate, TranscriptActionGate } from './actionGate.js';
import { mutateCart, readHealthProfile, saveConfirmedTranscript, saveHealthProfile } from './cartService.js';
import { getCacheStatus, getProducts, getValidAgeGroups, getValidConditions } from './sheetsService.js';

interface ClientMessage { type: 'authenticate' | 'audio_start' | 'audio_input' | 'audio_end' | 'confirm_transcript'; idToken?: string; audio?: string; text?: string }

const declaration = (name: string, description: string, properties: Record<string, unknown>, required: string[]): FunctionDeclaration => ({
  name, description, parameters: { type: Type.OBJECT, properties, required },
});
const stringProperty = (description: string) => ({ type: Type.STRING, description });
const numberProperty = (description: string) => ({ type: Type.NUMBER, description });

const tools: FunctionDeclaration[] = [
  declaration(
    'search_products',
    'Tìm sản phẩm OTC trong catalog đã xác thực. Phải suy luận ngữ nghĩa từ chi_dinh_ngan; không khớp từ khóa cứng như Red_Flags.',
    {
      trieu_chung: stringProperty('Triệu chứng đã được người dùng xác nhận'),
      loc_theo_doi_tuong: stringProperty('Đối tượng cần ưu tiên/lọc nếu người dùng đã cung cấp; để trống nếu chưa rõ'),
    },
    ['trieu_chung']
  ),
  declaration('get_health_profile', 'Đọc hồ sơ của người dùng đang xác thực.', {}, []),
  declaration('update_health_profile', 'Đề xuất cập nhật hồ sơ; lần gọi đầu không ghi dữ liệu.', { truong: stringProperty('benh_nen, doi_tuong, di_ung hoặc nhom_tuoi'), gia_tri: stringProperty('Giá trị cần đề xuất') }, ['truong', 'gia_tri']),
  declaration('add_to_cart', 'Thêm OTC qua cổng an toàn phía server.', { sku: stringProperty('SKU chính xác'), so_luong: numberProperty('Số lượng'), ly_do_va_bang_chung: stringProperty('Lý do và bằng chứng bắt buộc') }, ['sku', 'so_luong', 'ly_do_va_bang_chung']),
  declaration('remove_from_cart', 'Xóa SKU qua cổng an toàn phía server.', { sku: stringProperty('SKU chính xác') }, ['sku']),
  declaration('escalate_to_pharmacist', 'Chuyển cho dược sĩ.', { ly_do: stringProperty('Lý do') }, ['ly_do']),
];

function isProfileField(field: string): boolean {
  return ['benh_nen', 'doi_tuong', 'di_ung', 'nhom_tuoi'].includes(field);
}

export function setupLiveAgentWebSocket(wss: WebSocketServer) {
  wss.on('connection', (clientWs: WebSocket) => {
    const timer = setTimeout(() => clientWs.close(4401, 'Authentication timeout'), 8_000);
    clientWs.once('message', async (raw) => {
      clearTimeout(timer);
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;
        if (message.type !== 'authenticate' || !message.idToken) throw new Error('Authentication required');
        const userId = await verifyFirebaseToken(message.idToken);
        console.log(`[setupLiveAgentWebSocket] Authenticated user ${userId}, starting live session...`);
        await startLiveSession(clientWs, userId);
      } catch (err: any) {
        console.error('[setupLiveAgentWebSocket] Error during live session start:', err);
        clientWs.send(JSON.stringify({ type: 'error', message: `Phiên đăng nhập không hợp lệ hoặc lỗi kết nối: ${err?.message || String(err)}` }));
        clientWs.close(4401, 'Authentication required or connection error');
      }
    });
  });
}

async function startLiveSession(clientWs: WebSocket, userId: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY chưa được cấu hình phía server.' }));
    clientWs.close(1011, 'Server configuration error');
    return;
  }

  const safeSend = (payload: unknown) => {
    if (clientWs.readyState === clientWs.OPEN) clientWs.send(JSON.stringify(payload));
  };
  const actionGate = new TranscriptActionGate();
  const profileGate = new HealthProfileConfirmationGate();
  let pendingUserTranscript = '';
  let confirmedSafetyTranscript = '';
  let modelTranscript = '';

  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  const validConditions = getValidConditions();
  const validAgeGroups = getValidAgeGroups();
  const systemInstruction = `Bạn là trợ lý tư vấn nhà thuốc, nói chuyện thân thiện và ngắn gọn như một dược sĩ ngoài quầy. Bạn CHỈ được tư vấn thuốc không kê đơn và thực phẩm chức năng. Bạn KHÔNG BAO GIỜ chẩn đoán bệnh — chỉ được nói 'triệu chứng này thường gặp khi...', tuyệt đối không nói 'bạn bị...'. Bạn KHÔNG BAO GIỜ nhắc tên hay gợi ý thuốc kê đơn, kể cả khi người dùng nài nỉ hoặc nói rằng bác sĩ đã dặn. Hỏi tối đa 2 câu làm rõ rồi mới đề xuất sản phẩm. Luôn nói liều dùng đúng theo nhãn sản phẩm, không tự suy diễn. Khi không chắc chắn, hãy gọi escalate_to_pharmacist thay vì đoán.

Khi gọi search_products, hãy suy luận ngữ nghĩa giữa triệu chứng đã xác nhận và chi_dinh_ngan. Không yêu cầu khớp chính xác từng chữ và không dùng cơ chế từ khóa deterministic của Red_Flags cho việc gợi ý catalog. cach_dung_co_ban chỉ dùng để đọc thông tin theo nhãn; không dùng trường này để tính quá liều.

Chỉ gọi công cụ thay đổi trạng thái sau khi server báo transcript đã được người dùng xác nhận. update_health_profile luôn là đề xuất trước và cần một lượt xác nhận riêng. Mã điều kiện hợp lệ: [${validConditions.join(', ')}]. Nhóm tuổi hợp lệ: [${validAgeGroups.join(', ')}].`;

  const liveSession = await ai.live.connect({
    model: 'gemini-3.1-flash-live-preview',
    config: {
      responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      systemInstruction, tools: [{ functionDeclarations: tools }], inputAudioTranscription: {}, outputAudioTranscription: {},
    },
    callbacks: {
      onmessage: async (message: LiveServerMessage) => {
        for (const part of message.serverContent?.modelTurn?.parts || []) {
          if (part.inlineData?.data) safeSend({ type: 'audio', audio: part.inlineData.data });
        }
        if (message.serverContent?.interrupted) safeSend({ type: 'interrupted' });

        const inputText = message.serverContent?.inputTranscription?.text;
        if (inputText) {
          pendingUserTranscript = `${pendingUserTranscript} ${inputText}`.trim();
          actionGate.markPending();
          safeSend({ type: 'input_transcript', text: pendingUserTranscript });
        }
        const outputText = message.serverContent?.outputTranscription?.text;
        if (outputText) {
          modelTranscript = `${modelTranscript} ${outputText}`.trim();
          safeSend({ type: 'output_transcript', text: outputText });
        }

        if (!message.toolCall) return;
        const responses = [];
        for (const call of message.toolCall.functionCalls) {
          const name = call.name || '';
          const args = (call.args || {}) as Record<string, unknown>;
          let result: unknown = { success: false, message: 'Unknown tool' };
          const stateChanging = ['add_to_cart', 'remove_from_cart', 'update_health_profile'].includes(name);
          if (stateChanging && !actionGate.canMutate()) {
            result = { success: false, denied: true, message: `Từ chối: transcript chưa được xác nhận (state=${actionGate.state}).` };
          } else if (name === 'search_products') {
            const status = getCacheStatus();
            result = status.isHealthy ? {
              success: true,
              matching_strategy: 'Model semantic reasoning over chi_dinh_ngan; exact keyword matching is reserved for Red_Flags.',
              loc_theo_doi_tuong: String(args.loc_theo_doi_tuong || ''),
              products: getProducts().map((product) => ({ sku: product.sku, ten_san_pham: product.ten_san_pham, hoat_chat: product.hoat_chat, ham_luong_mg: product.ham_luong_mg, dang_bao_che: product.dang_bao_che, nhom: product.nhom, gia: product.gia, ton_kho: product.ton_kho, chi_dinh_ngan: product.chi_dinh_ngan, cach_dung_co_ban: product.cach_dung_co_ban })),
            } : { success: false, message: 'Dữ liệu an toàn đang không khỏe; không trả catalog.' };
          } else if (name === 'get_health_profile') {
            try {
              const profile = await readHealthProfile(userId);
              result = { success: true, status: profile.status, profile: profile.profile || {} };
            } catch (error) {
              result = { success: false, unsafe: true, message: `Không thể đọc hồ sơ: ${error instanceof Error ? error.message : String(error)}` };
            }
          } else if (name === 'update_health_profile') {
            const field = String(args.truong || '').trim();
            const value = String(args.gia_tri || '').trim().toLowerCase();
            const invalidCondition = ['benh_nen', 'doi_tuong'].includes(field) && !validConditions.includes(value);
            const invalidAgeGroup = field === 'nhom_tuoi' && !validAgeGroups.includes(value);
            if (!isProfileField(field) || !value || invalidCondition || invalidAgeGroup) result = { success: false, message: 'Trường hoặc giá trị hồ sơ không hợp lệ.' };
            else {
              profileGate.propose({ field, value });
              actionGate.markPending();
              result = { success: false, requires_confirmation: true, message: `Đề xuất ${field}=${value}. Hãy yêu cầu người dùng xác nhận rõ ràng.` };
            }
          } else if (name === 'add_to_cart') {
            const reason = String(args.ly_do_va_bang_chung || '').trim();
            if (!reason) result = { success: false, message: 'Thiếu lý do và bằng chứng.' };
            else {
              const cartResult = await mutateCart(userId, { type: 'add', sku: String(args.sku || ''), quantity: Number(args.so_luong), source: reason });
              result = cartResult;
              if (cartResult.success) safeSend({ type: 'cart_action', action: 'refresh', verdict: cartResult.verdict, warning: cartResult.reason });
            }
          } else if (name === 'remove_from_cart') {
            const cartResult = await mutateCart(userId, { type: 'remove', sku: String(args.sku || '') });
            result = cartResult;
            if (cartResult.success) safeSend({ type: 'cart_action', action: 'refresh', verdict: cartResult.verdict, warning: cartResult.reason });
          } else if (name === 'escalate_to_pharmacist') {
            result = { success: true };
            safeSend({ type: 'escalate', reason: String(args.ly_do || '') });
          }
          responses.push({ name, id: call.id, response: { result } });
        }
        liveSession.sendToolResponse({ functionResponses: responses });
      },
      onerror: (error) => safeSend({ type: 'error', message: error.message || 'Gemini Live session error' }),
      onclose: () => safeSend({ type: 'session_closed' }),
    },
  });

  safeSend({ type: 'session_ready' });
  clientWs.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;
      if (message.type === 'audio_start') actionGate.startListening();
      else if (message.type === 'audio_input' && message.audio) liveSession.sendRealtimeInput({ audio: { data: message.audio, mimeType: 'audio/pcm;rate=16000' } });
      else if (message.type === 'audio_end') actionGate.markPending();
      else if (message.type === 'confirm_transcript' && message.text?.trim()) {
        const text = message.text.trim();
        const confirmedProfileUpdate = profileGate.confirm(text);
        if (confirmedProfileUpdate) {
          await saveHealthProfile(userId, { [confirmedProfileUpdate.field]: confirmedProfileUpdate.value });
          safeSend({ type: 'health_profile_updated', truong: confirmedProfileUpdate.field, gia_tri: confirmedProfileUpdate.value });
          if (confirmedSafetyTranscript) {
            actionGate.confirm(confirmedSafetyTranscript);
            actionGate.markProcessing();
          } else {
            actionGate.markPending();
          }
        } else {
          await saveConfirmedTranscript(userId, text);
          confirmedSafetyTranscript = text;
          pendingUserTranscript = text;
          actionGate.confirm(text);
          actionGate.markProcessing();
        }
        liveSession.sendRealtimeInput({ text });
      }
    } catch (error) { safeSend({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  });
  clientWs.on('close', () => { try { liveSession.close(); } catch { /* already closed */ } });
}
