import { GoogleGenAI, Modality, Type, type FunctionDeclaration, type LiveServerMessage } from '@google/genai';
import type { WebSocket, WebSocketServer } from 'ws';
import { verifyFirebaseToken } from './auth.js';
import { HealthProfileConfirmationGate, TranscriptActionGate } from './actionGate.js';
import { UtteranceManager } from './utteranceManager.js';
import { mutateCart, readCart, readHealthProfile, saveConfirmedTranscript, saveHealthProfile, type CartOperation } from './cartService.js';
import { mapToAgeGroup } from './safetyService.js';
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
  return ['benh_nen', 'doi_tuong', 'di_ung', 'nhom_tuoi', 'do_tuoi', 'ghi_chu_suckhoe'].includes(field);
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
  const utteranceManager = new UtteranceManager();

  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } });
  const validConditions = getValidConditions();
  const validAgeGroups = getValidAgeGroups();

  // Pre-fetch current cart items and health profile for session context
  const [cartItems, profileData] = await Promise.all([
    readCart(userId).catch(() => []),
    readHealthProfile(userId).catch(() => ({ status: 'missing' as const, profile: null })),
  ]);

  const initialCartSummary = cartItems.length > 0
    ? cartItems.map((item) => `- ${item.name} (SKU: ${item.id}, SL: ${item.quantity}, Hoạt chất: ${item.activeIngredient || 'Chưa rõ'})`).join('\n')
    : '(Giỏ hàng hiện đang trống)';

  const profile = profileData.profile;
  const initialProfileSummary = profileData.status === 'found' && profile
    ? `- Nhóm tuổi / Độ tuổi: ${profile.nhom_tuoi || profile.do_tuoi || 'Chưa rõ'}
- Dị ứng: ${Array.isArray(profile.di_ung) ? (profile.di_ung.length ? profile.di_ung.join(', ') : 'Không') : (profile.di_ung || 'Chưa rõ')}
- Bệnh nền: ${Array.isArray(profile.benh_nen) ? (profile.benh_nen.length ? profile.benh_nen.join(', ') : 'Không') : (profile.benh_nen || 'Chưa rõ')}
- Đối tượng đặc biệt (Thai kỳ / Cho con bú): ${profile.doi_tuong || 'Chưa rõ'}`
    : '(Chưa có hồ sơ sức khỏe trong hệ thống - Cần hỏi người dùng)';

  const systemInstruction = `Bạn là Dược sĩ AI tư vấn nhà thuốc trực tuyến, nói chuyện thân thiện, chuyên nghiệp, ngắn gọn như dược sĩ tư vấn ngoài quầy. Bạn CHỈ tư vấn thuốc không kê đơn (OTC) và thực phẩm chức năng. Bạn KHÔNG BAO GIỜ chẩn đoán bệnh — chỉ được nói 'triệu chứng này thường gặp khi...', tuyệt đối không nói 'bạn bị...'. Bạn KHÔNG BAO GIỜ nhắc tên hay gợi ý thuốc kê đơn (RX).

==================================================
1. GIỎ HÀNG HIỆN TẠI CỦA NGƯỜI DÙNG:
${initialCartSummary}

LƯU Ý GIỎ HÀNG:
- Bạn ĐÃ BIẾT TOÀN BỘ SẢN PHẨM TRONG GIỎ HÀNG CỦA NGƯỜI DÙNG NGAY KHI BẮT ĐẦU.
- Khi người dùng hỏi về thuốc hoặc muốn mua thêm, bạn phải luôn kiểm tra sản phẩm sẵn có trong giỏ hàng để tránh trùng lặp hoạt chất (ví dụ: đã có Panadol hay thuốc chứa Paracetamol thì không gợi ý thêm Paracetamol khác) và cảnh báo tương tác thuốc nếu có.

==================================================
2. HỒ SƠ SỨC KHỎE HIỆN TẠI CỦA NGƯỜI DÙNG:
${initialProfileSummary}

==================================================
3. QUY TRÌNH NGUYÊN TẮC AN TOÀN & KHAI THÁC THÔNG TIN (RẤT QUAN TRỌNG):
- BẮT BUỘC HỎI THÔNG TIN BẢO VỆ AN TOÀN TRƯỚC KHI ĐỀ XUẤT THUỐC:
  Trước khi đưa ra bất kỳ lời khuyên dùng thuốc hay đề xuất thêm sản phẩm nào vào giỏ hàng (\`add_to_cart\`), bạn BẮT BUỘC phải đảm bảo đã biết các thông tin an toàn tối thiểu:
  (1) Độ tuổi / Nhóm tuổi của người dùng.
  (2) Tiền sử dị ứng (thuốc/thức ăn).
  (3) Bệnh nền hoặc Tình trạng thai kỳ / cho con bú.
- Nếu các thông tin trên trong hồ sơ còn 'Chưa rõ' hoặc chưa được người dùng nêu, bạn BẮT BUỘC PHẢI HỎI NGƯỜI DÙNG XÁC NHẬN/CUNG CẤP TRƯỚC KHI ĐỀ XUẤT BẤT KỲ SẢN PHẨM NÀO.
- Khi người dùng cung cấp thông tin mới (ví dụ: 'tôi 30 tuổi', 'tôi bị dị ứng aspirin'), hãy chủ động gọi công cụ \`update_health_profile\` để cập nhật hồ sơ cho người dùng.
- Hỏi tối đa 1-2 câu ngắn gọn làm rõ triệu chứng và thông tin an toàn.
- Luôn giải thích liều dùng đúng theo nhãn sản phẩm (cach_dung_co_ban), không tự suy diễn.
- Khi gặp câu hỏi phức tạp hoặc không chắc chắn về an toàn, hãy gọi escalate_to_pharmacist.

==================================================
4. QUY TẮC SỬ DỤNG CÔNG CỤ (TOOLS):
- search_products: Suy luận ngữ nghĩa giữa triệu chứng đã xác nhận và chi_dinh_ngan.
- update_health_profile: Đề xuất cập nhật hồ sơ; lần đầu gọi chỉ gửi đề xuất cho người dùng xác nhận.
- Chỉ gọi add_to_cart, remove_from_cart hay update_health_profile sau khi server xác nhận người dùng đã đồng ý transcript.
- Mã điều kiện hợp lệ: [${validConditions.join(', ')}]. Nhóm tuổi hợp lệ: [${validAgeGroups.join(', ')}].`;

  let isLiveSessionOpen = true;

  let liveSession: any = null;
  try {
    liveSession = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      config: {
        responseModalities: [Modality.AUDIO], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        systemInstruction, tools: [{ functionDeclarations: tools }], inputAudioTranscription: {}, outputAudioTranscription: {},
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: true,
          },
        },
      },
      callbacks: {
        onerror: (err: any) => {
          console.error('[liveAgentHandler] Gemini Live session error:', err);
          safeSend({ type: 'error', message: `Lỗi kết nối Dược sĩ AI: ${err?.message || String(err)}` });
        },
        onclose: (event: any) => {
          isLiveSessionOpen = false;
          console.warn('[liveAgentHandler] Gemini Live session closed:', event?.code, event?.reason);
          const rawReason = event?.reason || (event?.target as any)?._closeMessage?.toString() || '';
          let msg = 'Kết nối Dược sĩ AI đã đóng.';
          if (event?.code === 1011 || rawReason.includes('prepayment credits') || rawReason.includes('RESOURCE_EXHAUSTED')) {
            msg = '⚠️ Tài khoản Gemini API Key hiện đã hết hạn mức credit (Prepayment credits depleted). Vui lòng cập nhật API Key khả dụng trong phần Cấu hình Settings.';
          } else if (rawReason) {
            msg = `Kết nối Dược sĩ AI bị gián đoạn: ${rawReason}`;
          }
          safeSend({ type: 'error', message: msg });
        },
        onmessage: async (message: LiveServerMessage) => {
          for (const part of message.serverContent?.modelTurn?.parts || []) {
            if (part.inlineData?.data) safeSend({ type: 'audio', audio: part.inlineData.data });
          }
          if (message.serverContent?.interrupted) safeSend({ type: 'interrupted' });

        const inputText = message.serverContent?.inputTranscription?.text;
        if (inputText) {
          const current = utteranceManager.appendInputFragment(inputText);
          actionGate.markPending();
          safeSend({ type: 'input_transcript', text: current });
        }
        const outputText = message.serverContent?.outputTranscription?.text;
        if (outputText) {
          const modelText = utteranceManager.appendOutputFragment(outputText);
          safeSend({ type: 'output_transcript', text: outputText });
        }

        if (!message.toolCall) return;
        const responses = [];
        for (const call of message.toolCall.functionCalls) {
          const name = call.name || '';
          const args = (call.args || {}) as Record<string, unknown>;
          let result: unknown = { success: false, message: 'Unknown tool' };
          if (name === 'search_products') {
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
            const value = String(args.gia_tri || '').trim();
            if (!isProfileField(field) || !value) {
              result = { success: false, message: 'Trường hoặc giá trị hồ sơ không hợp lệ.' };
            } else {
              const updates: Record<string, string> = { [field]: value };
              if (['do_tuoi', 'nhom_tuoi'].includes(field)) {
                const mappedAge = mapToAgeGroup(value);
                if (mappedAge.nhom_tuoi) updates.nhom_tuoi = mappedAge.nhom_tuoi;
                if (mappedAge.do_tuoi) updates.do_tuoi = mappedAge.do_tuoi;
              }
              await saveHealthProfile(userId, updates);
              safeSend({ type: 'health_profile_updated', truong: field, gia_tri: value });
              result = {
                success: true,
                message: `Đã tự động cập nhật hồ sơ sức khỏe: ${field} thành "${value}".`
              };
            }
          } else if (name === 'add_to_cart') {
            const reason = String(args.ly_do_va_bang_chung || '').trim();
            if (!reason) {
              result = { success: false, message: 'Thiếu lý do và bằng chứng.' };
            } else {
              const currentTranscript = utteranceManager.getCurrentUtterance() || 'Yêu cầu thêm sản phẩm bằng giọng nói';
              await saveConfirmedTranscript(userId, currentTranscript);
              actionGate.confirm(currentTranscript);

              const cartResult = await mutateCart(userId, { type: 'add', sku: String(args.sku || ''), quantity: Number(args.so_luong) || 1, source: reason }, 'voice_ai');
              result = cartResult;
              if (cartResult.success) {
                safeSend({ type: 'cart_action', action: 'refresh', verdict: cartResult.verdict, warning: cartResult.reason });
              }
            }
          } else if (name === 'remove_from_cart') {
            const currentTranscript = utteranceManager.getCurrentUtterance() || 'Yêu cầu xóa sản phẩm bằng giọng nói';
            await saveConfirmedTranscript(userId, currentTranscript);
            actionGate.confirm(currentTranscript);

            const cartResult = await mutateCart(userId, { type: 'remove', sku: String(args.sku || '') }, 'voice_ai');
            result = cartResult;
            if (cartResult.success) {
              safeSend({ type: 'cart_action', action: 'refresh', verdict: cartResult.verdict, warning: cartResult.reason });
            }
          } else if (name === 'escalate_to_pharmacist') {
            result = { success: true };
            safeSend({ type: 'escalate', reason: String(args.ly_do || '') });
          }
          responses.push({ name, id: call.id, response: { result } });
        }
        liveSession?.sendToolResponse?.({ functionResponses: responses });
      },
    },
  });

  safeSend({ type: 'session_ready' });
  clientWs.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;
      if (!isLiveSessionOpen || !liveSession) {
        safeSend({ type: 'error', message: 'Dược sĩ AI chưa sẵn sàng hoặc kết nối Live đã bị ngắt. Hãy kiểm tra API key trong Settings.' });
        return;
      }
      if (message.type === 'audio_start') {
        utteranceManager.startUtterance();
        actionGate.startListening();
        liveSession.sendRealtimeInput({ activityStart: {} });
      } else if (message.type === 'audio_input' && message.audio) {
        liveSession.sendRealtimeInput({ audio: { data: message.audio, mimeType: 'audio/pcm;rate=16000' } });
      } else if (message.type === 'audio_end') {
        actionGate.markPending();
        liveSession.sendRealtimeInput({ activityEnd: {} });
      } else if (message.type === 'confirm_transcript' && message.text?.trim()) {
        const text = message.text.trim();
        utteranceManager.confirm(text);
        const confirmedProfileUpdate = profileGate.confirm(text);
        if (confirmedProfileUpdate) {
          const updates: Record<string, string> = { [confirmedProfileUpdate.field]: confirmedProfileUpdate.value };
          if (['do_tuoi', 'nhom_tuoi'].includes(confirmedProfileUpdate.field)) {
            const mappedAge = mapToAgeGroup(confirmedProfileUpdate.value);
            if (mappedAge.nhom_tuoi) updates.nhom_tuoi = mappedAge.nhom_tuoi;
            if (mappedAge.do_tuoi) updates.do_tuoi = mappedAge.do_tuoi;
          }
          await saveHealthProfile(userId, updates);
          safeSend({ type: 'health_profile_updated', truong: confirmedProfileUpdate.field, gia_tri: confirmedProfileUpdate.value });
          if (utteranceManager.getConfirmedTranscript()) {
            actionGate.confirm(utteranceManager.getConfirmedTranscript());
            actionGate.markProcessing();
          } else {
            actionGate.markPending();
          }
        } else {
          await saveConfirmedTranscript(userId, text);
          actionGate.confirm(text);
          actionGate.markProcessing();
        }

        // Execute any pending cart operation since transcript is now confirmed
        const pendingOp = actionGate.getPendingCartOp();
        if (pendingOp) {
          try {
            let operation: CartOperation;
            if (pendingOp.type === 'add') {
              operation = {
                type: 'add',
                sku: pendingOp.sku,
                quantity: pendingOp.quantity || 1,
                source: pendingOp.source
              };
            } else {
              operation = {
                type: 'remove',
                sku: pendingOp.sku
              };
            }
            const cartResult = await mutateCart(userId, operation, 'voice_ai');
            if (cartResult.success) {
              safeSend({ type: 'cart_action', action: 'refresh', verdict: cartResult.verdict, warning: cartResult.reason });
            } else {
              console.warn('[liveAgentHandler] Auto-execute of pending cart operation failed:', cartResult.reason);
              safeSend({ type: 'error', message: `Không thể tự động cập nhật giỏ hàng: ${cartResult.reason}` });
            }
          } catch (error) {
            console.error('[liveAgentHandler] Error executing pending cart operation:', error);
          } finally {
            actionGate.clearPendingCartOp();
          }
        }

        liveSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        });
      }
    } catch (error) { safeSend({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
  });
    clientWs.on('close', () => { try { liveSession?.close(); } catch { /* already closed */ } });
  } catch (err: any) {
    isLiveSessionOpen = false;
    console.error('[liveAgentHandler] Failed to initialize live session:', err);
    safeSend({
      type: 'error',
      message: `Không thể khởi tạo Gemini Live: ${err?.message || String(err)}. Kiểm tra API Key trong Settings.`
    });
  }
}
