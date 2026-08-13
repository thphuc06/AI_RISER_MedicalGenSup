import { GoogleGenAI, Modality, Type, type FunctionDeclaration, type LiveServerMessage } from '@google/genai';
import type { WebSocket, WebSocketServer } from 'ws';
import { verifyFirebaseToken } from './auth.js';
import { HealthProfileConfirmationGate, TranscriptActionGate } from './actionGate.js';
import { UtteranceManager } from './utteranceManager.js';
import { mutateCart, readCart, readHealthProfile, saveConfirmedTranscript, saveHealthProfile, type CartOperation } from './cartService.js';
import { getContraindicationsForQuery, getMaxDoseForQuery, mapToAgeGroup } from './safetyService.js';
import { getCacheStatus, getProducts, getSafetyData, getValidAgeGroups, getValidConditions } from './sheetsService.js';
import { searchProductsSemantic, searchContraindicationsSemantic } from './semanticSearch.js';
import { createAppointment, findAvailablePharmacist, checkPharmacistsAvailability, getPharmacists } from './appointmentService.js';

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
  declaration(
    'update_health_profile',
    'Cập nhật hồ sơ sức khỏe. Nếu là độ tuổi/số tuổi (ví dụ: "16 tuổi", "30"), hệ thống sẽ lưu số tuổi tự nhiên và tự động quy đổi ra nhóm tuổi tương ứng.',
    {
      truong: stringProperty('trường cần cập nhật: do_tuoi, nhom_tuoi, benh_nen, di_ung, doi_tuong'),
      gia_tri: stringProperty('Giá trị cần cập nhật (ví dụ: "16 tuổi", "Đau dạ dày", "Dị ứng Aspirin")')
    },
    ['truong', 'gia_tri']
  ),
  declaration(
    'get_contraindications',
    'Tra cứu quy tắc chống chỉ định (bệnh nền, thai kỳ, nhóm tuổi, đối tượng) theo tên hoạt chất, SKU sản phẩm, hoặc theo bệnh nền/triệu chứng của bệnh nhân.',
    {
      hoat_chat: stringProperty('Tên hoạt chất cần kiểm tra (ví dụ: paracetamol, ibuprofen, aspirin, pseudoephedrine...)'),
      sku: stringProperty('Mã SKU sản phẩm (nếu muốn kiểm tra sản phẩm cụ thể)'),
      benh_nen_hoac_trieu_chung: stringProperty('Bệnh nền hoặc triệu chứng của bệnh nhân để tìm kiếm quy tắc chống chỉ định tương đồng ngữ nghĩa bằng pgvector'),
    },
    []
  ),
  declaration(
    'get_max_dose',
    'Tra cứu giới hạn liều tối đa hàng ngày (mg/ngày) theo hoạt chất và nhóm tuổi/số tuổi từ cơ sở dữ liệu quy tắc liều lượng.',
    {
      hoat_chat: stringProperty('Tên hoạt chất (ví dụ: paracetamol, ibuprofen, loratadine)'),
      do_tuoi_hoac_nhom_tuoi: stringProperty('Số tuổi (ví dụ: 16, 65) hoặc nhóm tuổi (tre_em, nguoi_lon, nguoi_cao_tuoi)'),
    },
    ['hoat_chat']
  ),
  declaration('add_to_cart', 'Thêm OTC qua cổng an toàn phía server.', { sku: stringProperty('SKU chính xác'), so_luong: numberProperty('Số lượng'), ly_do_va_bang_chung: stringProperty('Lý do và bằng chứng bắt buộc') }, ['sku', 'so_luong', 'ly_do_va_bang_chung']),
  declaration('remove_from_cart', 'Xóa SKU qua cổng an toàn phía server.', { sku: stringProperty('SKU chính xác') }, ['sku']),
  declaration('escalate_to_pharmacist', 'Chuyển cho dược sĩ.', { ly_do: stringProperty('Lý do') }, ['ly_do']),
  declaration(
    'check_pharmacists_availability',
    'Kiểm tra danh sách dược sĩ và các khung giờ rảnh (lịch trống) của họ dựa trên một hoặc nhiều chuyên khoa (ngăn cách bằng dấu phẩy) và ngày yêu cầu. Hệ thống tự động xếp thứ tự ưu tiên dược sĩ khớp nhiều chuyên khoa nhất.',
    {
      chuyen_khoa: stringProperty('Chuyên khoa hoặc danh sách chuyên khoa phân tách bằng dấu phẩy (ví dụ: "Tim mạch & Huyết áp", hoặc "Tim mạch & Huyết áp, Nội tổng quát")'),
      ngay: stringProperty('Ngày cần kiểm tra (ví dụ: "Hôm nay", "Ngày mai", hoặc định dạng "YYYY-MM-DD")')
    },
    ['chuyen_khoa', 'ngay']
  ),
  declaration(
    'schedule_consultation',
    'Tự động đặt lịch tư vấn trực tuyến qua Google Meet với Dược sĩ/Bác sĩ chuyên khoa khi bệnh nhân yêu cầu hoặc đơn thuộc Tier 1 nguy cơ cao. Chấp nhận danh sách chuyên khoa phân tách bằng dấu phẩy để hệ thống tự lựa chọn dược sĩ phù hợp nhất theo trọng số.',
    {
      chuyen_khoa: stringProperty('Chuyên khoa hoặc danh sách chuyên khoa phân tách bằng dấu phẩy (ví dụ: "Tim mạch & Huyết áp", hoặc "Tim mạch & Huyết áp, Nội tổng quát")'),
      ngay_gio: stringProperty('Ngày giờ đề xuất (ví dụ: "09:30 sáng mai", "14:00 hôm nay", "09:00 - 09:30, Hôm nay")'),
      ghi_chu_tu_van: stringProperty('Ghi chú lý do tư vấn hoặc cảnh báo nguy cơ từ đơn thuốc'),
      pharmacist_id: stringProperty('Mã ID dược sĩ đã chọn từ danh sách check_pharmacists_availability (tùy chọn)')
    },
    ['chuyen_khoa', 'ngay_gio', 'ghi_chu_tu_van']
  ),
];

function isProfileField(field: string): boolean {
  return ['benh_nen', 'doi_tuong', 'di_ung', 'nhom_tuoi', 'do_tuoi', 'ghi_chu_suckhoe', 'conditions', 'allergies', 'age'].includes(field);
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

  // Pre-fetch current cart items, health profile, and pharmacists for session context
  const [cartItems, profileData, pharmacists] = await Promise.all([
    readCart(userId).catch(() => []),
    readHealthProfile(userId).catch(() => ({ status: 'missing' as const, profile: null })),
    getPharmacists().catch(() => []),
  ]);

  const uniqueSpecialties = Array.from(
    new Set(pharmacists.flatMap((p) => p.specialties || []))
  );
  const specialtiesSummary = uniqueSpecialties.length > 0
    ? uniqueSpecialties.map((s) => `- ${s}`).join('\n')
    : '- Chưa cấu hình chuyên khoa (Liên hệ ban quản trị)';

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
- Khi người dùng cung cấp thông tin mới (ví dụ: 'tôi 16 tuổi', 'tôi 30 tuổi', 'tôi bị dị ứng aspirin', 'tôi bị đau dạ dày'), hãy chủ động gọi công cụ 'update_health_profile' để cập nhật hồ sơ. Hệ thống sẽ lưu chính xác tuổi (ví dụ: "16 tuổi") và tự động quy đổi ra nhom_tuoi tương ứng (tre_em, nguoi_lon, nguoi_cao_tuoi).
- Hỏi tối đa 1-2 câu ngắn gọn làm rõ triệu chứng và thông tin an toàn.
- Bạn có thể chủ động sử dụng công cụ 'get_contraindications' và 'get_max_dose' để kiểm tra quy tắc an toàn thuốc, chống chỉ định và liều tối đa hàng ngày.
- Luôn giải thích liều dùng đúng theo nhãn sản phẩm (cach_dung_co_ban), không tự suy diễn.
- Khi gặp câu hỏi phức tạp hoặc không chắc chắn về an toàn, hãy gọi escalate_to_pharmacist.

==================================================
4. QUY TẮC SỬ DỤNG CÔNG CỤ (TOOLS):
- search_products: Suy luận ngữ nghĩa giữa triệu chứng đã xác nhận và chi_dinh_ngan.
- get_contraindications: Tra cứu chống chỉ định của hoạt chất đối với các bệnh nền/thai kỳ/đối tượng đặc biệt từ cơ sở dữ liệu.
- get_max_dose: Tra cứu giới hạn liều dùng tối đa mg/ngày theo hoạt chất và độ tuổi hoặc nhóm tuổi.
- update_health_profile: Cập nhật thông tin hồ sơ sức khỏe.
- Chỉ gọi add_to_cart, remove_from_cart hay update_health_profile sau khi người dùng đồng ý/yêu cầu trong cuộc trò chuyện.

==================================================
5. QUY TRÌNH ĐẶT LỊCH HẸN VỚI DƯỢC SĨ BAN TRỰC (QUAN TRỌNG):
Khi người dùng yêu cầu đặt lịch hẹn, gặp dược sĩ tư vấn hoặc khi đơn thuốc thuộc loại Tier 1 cần tư vấn khẩn cấp:
(1) Hãy lịch sự hỏi người dùng về thời gian rảnh mong muốn của họ (ví dụ: "Hôm nay", "Ngày mai").
(2) Gọi công cụ 'check_pharmacists_availability' với chuyên khoa và ngày rảnh đó để tra cứu danh sách dược sĩ và các lịch trống của họ.
(3) Đọc danh sách các dược sĩ rảnh kèm theo tối đa 2-3 khung giờ trống tiêu biểu cho người dùng lựa chọn (VD: "DS. Trần Hoàng Phúc đang trống lịch lúc 9:00 và 10:30 sáng mai, hoặc DS. Nguyễn Thị Linh trống lịch lúc 14:00"). Hãy đọc thật ngắn gọn, tự nhiên.
(4) Khi bệnh nhân xác nhận lựa chọn của mình, hãy gọi công cụ 'schedule_consultation' với chuyên khoa, ngày giờ chính xác và 'pharmacist_id' của dược sĩ đã được chọn để chính thức chốt lịch hẹn cho họ.

==================================================
6. DANH SÁCH CHUYÊN KHOA KHẢ DỤNG THỰC TẾ TRÊN HỆ THỐNG (Firestore):
${specialtiesSummary}
- Bạn chỉ được gợi ý đặt lịch hẹn cho các chuyên khoa có trong danh sách thực tế trên. Hãy tự động ánh xạ triệu chứng của bệnh nhân sang một hoặc nhiều chuyên khoa phù hợp nhất trong danh sách trên (phân tách bằng dấu phẩy) khi gọi công cụ check_pharmacists_availability.`;

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
            const trieu_chung = String(args.trieu_chung || '').trim();
            if (!trieu_chung) {
              result = { success: false, message: 'Vui lòng cung cấp triệu chứng cần tìm kiếm.' };
            } else {
              try {
                // Call pgvector semantic search over products
                const matchedProducts = await searchProductsSemantic(trieu_chung, 6);
                result = {
                  success: true,
                  matching_strategy: 'Semantic search using pgvector (text-embedding-004) over product names and indications',
                  trieu_chung,
                  loc_theo_doi_tuong: String(args.loc_theo_doi_tuong || ''),
                  products: matchedProducts.map((product) => ({
                    sku: product.sku,
                    ten_san_pham: product.ten_san_pham,
                    hoat_chat: product.hoat_chat,
                    ham_luong_mg: product.ham_luong_mg,
                    dang_bao_che: product.dang_bao_che,
                    nhom: product.nhom,
                    gia: product.gia,
                    ton_kho: product.ton_kho,
                    chi_dinh_ngan: product.chi_dinh_ngan,
                    cach_dung_co_ban: product.cach_dung_co_ban,
                    distance: (product as any).distance
                  })),
                };
              } catch (searchErr) {
                console.error('[search_products tool] Semantic search failed:', searchErr);
                // Fallback to in-memory
                result = {
                  success: true,
                  matching_strategy: 'In-memory fallback (semantic search failed)',
                  products: getProducts().slice(0, 15).map((product) => ({
                    sku: product.sku, ten_san_pham: product.ten_san_pham, hoat_chat: product.hoat_chat, ham_luong_mg: product.ham_luong_mg, dang_bao_che: product.dang_bao_che, nhom: product.nhom, gia: product.gia, ton_kho: product.ton_kho, chi_dinh_ngan: product.chi_dinh_ngan, cach_dung_co_ban: product.cach_dung_co_ban
                  })),
                };
              }
            }
          } else if (name === 'get_health_profile') {
            try {
              const profile = await readHealthProfile(userId);
              result = { success: true, status: profile.status, profile: profile.profile || {} };
            } catch (error) {
              result = { success: false, unsafe: true, message: `Không thể đọc hồ sơ: ${error instanceof Error ? error.message : String(error)}` };
            }
          } else if (name === 'get_contraindications') {
            const hoat_chat = String(args.hoat_chat || '').trim();
            const sku = String(args.sku || '').trim();
            const benh_nen_hoac_trieu_chung = String(args.benh_nen_hoac_trieu_chung || '').trim();

            let rules: any[] = [];
            let strategy = 'Active ingredient / SKU lookup from safety rules';

            if (benh_nen_hoac_trieu_chung) {
              strategy = `Semantic search using pgvector (text-embedding-004) for condition matching: "${benh_nen_hoac_trieu_chung}"`;
              try {
                // Perform semantic query over contraindications
                const matchedContra = await searchContraindicationsSemantic(benh_nen_hoac_trieu_chung, 8);
                rules = matchedContra;

                // Optionally filter semantically matched rules if hoat_chat or SKU is specified
                if (hoat_chat || sku) {
                  let targetIngredients: string[] = [];
                  if (sku) {
                    const product = getProducts().find(p => p.sku.toLowerCase() === sku.toLowerCase());
                    if (product) {
                      const ingredients = (product.hoat_chat || '').split(';').map(i => i.trim().toLowerCase());
                      targetIngredients.push(...ingredients);
                    }
                  }
                  if (hoat_chat) {
                    targetIngredients.push(...hoat_chat.split(';').map(i => i.trim().toLowerCase()));
                  }

                  if (targetIngredients.length > 0) {
                    rules = rules.filter(r => {
                      const ruleIng = (r.hoat_chat || '').toLowerCase();
                      return targetIngredients.some(t => t === ruleIng || t.includes(ruleIng) || ruleIng.includes(t));
                    });
                  }
                }
              } catch (semErr) {
                console.error('[get_contraindications tool] Semantic search failed, falling back to standard lookup:', semErr);
              }
            }

            // If no semantic query was performed or if rules are still empty, fall back to the standard lookup
            if (rules.length === 0) {
              const safetyData = getSafetyData();
              rules = getContraindicationsForQuery({ hoat_chat, sku }, safetyData);
            }

            result = {
              success: true,
              matching_strategy: strategy,
              total_matched: rules.length,
              contraindications: rules.map((r) => ({
                hoat_chat: r.hoat_chat,
                dieu_kien: r.dieu_kien,
                loai: r.loai,
                muc_do: r.muc_do,
                ly_do_ngan_gon: r.ly_do_ngan_gon,
                distance: r.distance
              })),
            };
          } else if (name === 'get_max_dose') {
            const safetyData = getSafetyData();
            const rules = getMaxDoseForQuery(
              {
                hoat_chat: String(args.hoat_chat || ''),
                do_tuoi_hoac_nhom_tuoi: (args.do_tuoi_hoac_nhom_tuoi as string | number) || '',
              },
              safetyData
            );
            result = {
              success: true,
              total_matched: rules.length,
              max_doses: rules.map((r) => ({
                hoat_chat: r.hoat_chat,
                nhom_tuoi: r.nhom_tuoi,
                max_mg_ngay: r.max_mg_ngay,
              })),
            };
          } else if (name === 'update_health_profile') {
            const field = String(args.truong || '').trim();
            const value = String(args.gia_tri || '').trim();
            if (!isProfileField(field) || !value) {
              result = { success: false, message: 'Trường hoặc giá trị hồ sơ không hợp lệ.' };
            } else {
              const updates: Record<string, string> = { [field]: value };
              if (['do_tuoi', 'nhom_tuoi', 'age'].includes(field)) {
                const mappedAge = mapToAgeGroup(value);
                if (mappedAge.nhom_tuoi) updates.nhom_tuoi = mappedAge.nhom_tuoi;
                if (mappedAge.do_tuoi) updates.do_tuoi = mappedAge.do_tuoi;
              }
              await saveHealthProfile(userId, updates);
              safeSend({ type: 'health_profile_updated', truong: field, gia_tri: value });
              result = {
                success: true,
                message: `Đã tự động cập nhật hồ sơ sức khỏe: ${field} thành "${value}".${updates.nhom_tuoi ? ` (Nhóm tuổi phân loại: ${updates.nhom_tuoi})` : ''}`
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
          } else if (name === 'check_pharmacists_availability') {
            const chuyen_khoa = String(args.chuyen_khoa || 'Tư vấn Dược lâm sàng');
            const ngay = String(args.ngay || 'Hôm nay');
            try {
              const availability = await checkPharmacistsAvailability(chuyen_khoa, ngay);
              result = {
                success: true,
                specialty: chuyen_khoa,
                date: ngay,
                pharmacists: availability.map(p => ({
                  pharmacist_id: p.pharmacistId,
                  full_name: p.fullName,
                  specialties: p.specialties,
                  is_online: p.isOnline,
                  available_slots: p.availableSlots.slice(0, 8)
                }))
              };
            } catch (err: any) {
              result = { success: false, message: `Lỗi kiểm tra lịch trống: ${err.message || String(err)}` };
            }
          } else if (name === 'schedule_consultation') {
            const chuyen_khoa = String(args.chuyen_khoa || 'Tư vấn Dược lâm sàng');
            const ngay_gio = String(args.ngay_gio || '09:30 sáng mai');
            const ghi_chu_tu_van = String(args.ghi_chu_tu_van || 'Tư vấn sử dụng thuốc và kiểm tra nguy cơ');
            const selectedPharmacistId = args.pharmacist_id ? String(args.pharmacist_id) : '';

            const profileRes = await readHealthProfile(userId);
            const profile = profileRes.profile || {};
            const patientName = String(profile.ho_ten || 'Bệnh nhân');

            let assignedPharmacist;
            if (selectedPharmacistId) {
              const pharmacists = await getPharmacists();
              assignedPharmacist = pharmacists.find(p => p.id === selectedPharmacistId);
            }

            if (!assignedPharmacist) {
              assignedPharmacist = await findAvailablePharmacist(chuyen_khoa);
            }

            const appointment = await createAppointment({
              patientId: userId,
              patientName,
              patientPhone: '0901234567',
              pharmacistId: assignedPharmacist.id,
              pharmacistName: assignedPharmacist.fullName,
              pharmacistEmail: assignedPharmacist.email,
              specialty: chuyen_khoa,
              dateTime: new Date(Date.now() + 3600 * 1000 * 24).toISOString(),
              timeSlot: ngay_gio,
              topic: ghi_chu_tu_van,
              notes: `Đặt lịch tự động bởi trợ lý giọng nói Gemini Live cho bệnh nhân ${patientName}.`,
            });

            safeSend({ type: 'appointment_created', appointment });
            result = {
              success: true,
              message: `Đã đặt thành công lịch hẹn tư vấn trực tuyến với ${appointment.pharmacistName} (${appointment.specialty}) vào lúc ${ngay_gio}. Đường link họp Google Meet: ${appointment.meetUrl}`,
              meetUrl: appointment.meetUrl,
            };
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
        safeSend({ type: 'interrupted' });
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
