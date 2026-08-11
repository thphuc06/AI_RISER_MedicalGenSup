import './server/env.js';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import { requireFirebaseUser, type AuthenticatedRequest } from './server/auth.js';
import { checkoutCart, mutateCart, saveHealthProfile, readCart, readHealthProfile, type CartOperation } from './server/cartService.js';
import { setupLiveAgentWebSocket } from './server/liveAgentHandler.js';
import { mapToAgeGroup } from './server/safetyService.js';
import { getCacheStatus, getContraindications, getMaxDoses, getProducts, getRedFlags, getValidAgeGroups, getValidConditions, loadAllSheets, startPeriodicRefresh, reloadSafetyDataFromPostgres } from './server/sheetsService.js';
import { computeOrderTriageScore } from './src/utils/triageCalculator.js';
import { db } from './src/db/index.js';
import { products, contraindications, maxDoses, redFlags } from './src/db/schema.js';
import { getEmbedding } from './server/syncService.js';
import { eq } from 'drizzle-orm';

const EXPECTED_PROJECT_ID = 'project-c55c421d-248e-4800-bfb';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const upgradeAttempts = new Map<string, number[]>();
  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname !== '/api/live') return socket.destroy();
      const ip = request.socket.remoteAddress || 'unknown';
      const now = Date.now();
      const recent = (upgradeAttempts.get(ip) || []).filter((time) => now - time < 60_000);
      if (recent.length >= 10) return socket.destroy();
      recent.push(now);
      upgradeAttempts.set(ip, recent);
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
    } catch (error) {
      console.error('[Server] Upgrade handling error:', error);
      socket.destroy();
    }
  });
  setupLiveAgentWebSocket(wss);

  await startPeriodicRefresh(10);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', projectId: EXPECTED_PROJECT_ID, sheets: getCacheStatus(), timestamp: new Date().toISOString() }));

  const healthyData = (res: express.Response, data: unknown[]) => {
    const status = getCacheStatus();
    if (!status.isHealthy) return res.status(503).json({ success: false, error: status.lastError || 'Safety data unavailable', data: [] });
    return res.json({ success: true, count: data.length, data });
  };
  app.get('/api/pharmacy/products', (_req, res) => healthyData(res, getProducts()));
  app.get('/api/pharmacy/contraindications', (_req, res) => healthyData(res, getContraindications()));
  app.get('/api/pharmacy/max-doses', (_req, res) => healthyData(res, getMaxDoses()));
  app.get('/api/pharmacy/red-flags', (_req, res) => healthyData(res, getRedFlags()));
  app.get('/api/pharmacy/status', (_req, res) => res.json({ success: true, data: getCacheStatus() }));

  app.post('/api/pharmacy/sync', requireFirebaseUser, async (req, res) => {
    const configuredSecret = process.env.ADMIN_SYNC_SECRET;
    if (!configuredSecret || req.headers['x-admin-sync-secret'] !== configuredSecret) return res.status(403).json({ success: false, error: 'Administrative sync is disabled or unauthorized' });
    const status = await loadAllSheets();
    return res.status(status.isHealthy ? 200 : 503).json({ success: status.isHealthy, message: status.isHealthy ? 'Google Sheets synced successfully' : 'Google Sheets sync failed', data: status });
  });

  // ADMIN CRUD API ENDPOINTS (Direct PostgreSQL write + real-time Gemini Embedding sync + Cache reload)
  
  // 1. PRODUCTS
  app.post('/api/admin/products', requireFirebaseUser, async (req, res) => {
    try {
      const prod = req.body;
      if (!prod || !prod.sku || !prod.ten_san_pham || !prod.hoat_chat) {
        return res.status(400).json({ success: false, error: 'Thiếu thông tin sản phẩm thiết yếu.' });
      }

      // Generate embedding dynamically
      const embedText = `${prod.ten_san_pham}. Chỉ định: ${prod.chi_dinh_ngan || ''}`;
      const embedding = await getEmbedding(embedText);

      await db.insert(products)
        .values({
          sku: prod.sku,
          ten_san_pham: prod.ten_san_pham,
          hoat_chat: prod.hoat_chat,
          ham_luong_mg: prod.ham_luong_mg || '',
          dang_bao_che: prod.dang_bao_che || '',
          nhom: prod.nhom || '',
          rx_status: prod.rx_status || 'OTC',
          gia: Number(prod.gia || 0),
          ton_kho: Number(prod.ton_kho || 0),
          chi_dinh_ngan: prod.chi_dinh_ngan || '',
          cach_dung_co_ban: prod.cach_dung_co_ban || '',
          embedding: embedding,
        })
        .onConflictDoUpdate({
          target: products.sku,
          set: {
            ten_san_pham: prod.ten_san_pham,
            hoat_chat: prod.hoat_chat,
            ham_luong_mg: prod.ham_luong_mg || '',
            dang_bao_che: prod.dang_bao_che || '',
            nhom: prod.nhom || '',
            rx_status: prod.rx_status || 'OTC',
            gia: Number(prod.gia || 0),
            ton_kho: Number(prod.ton_kho || 0),
            chi_dinh_ngan: prod.chi_dinh_ngan || '',
            cach_dung_co_ban: prod.cach_dung_co_ban || '',
            embedding: embedding,
            updatedAt: new Date(),
          }
        });

      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã lưu sản phẩm và tạo vector embedding thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error saving product:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  app.delete('/api/admin/products/:sku', requireFirebaseUser, async (req, res) => {
    try {
      const { sku } = req.params;
      await db.delete(products).where(eq(products.sku, sku));
      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã xóa sản phẩm thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error deleting product:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 2. CONTRAINDICATIONS
  app.post('/api/admin/contraindications', requireFirebaseUser, async (req, res) => {
    try {
      const contra = req.body;
      if (!contra || !contra.hoat_chat || !contra.dieu_kien) {
        return res.status(400).json({ success: false, error: 'Thiếu thông tin chống chỉ định thiết yếu.' });
      }

      // Generate embedding dynamically
      const embedding = await getEmbedding(contra.dieu_kien);

      if (contra.id) {
        // Update existing
        await db.update(contraindications)
          .set({
            hoat_chat: contra.hoat_chat,
            dieu_kien: contra.dieu_kien,
            loai: contra.loai || '',
            muc_do: contra.muc_do || '',
            ly_do_ngan_gon: contra.ly_do_ngan_gon || '',
            embedding: embedding,
          })
          .where(eq(contraindications.id, Number(contra.id)));
      } else {
        // Insert new
        await db.insert(contraindications)
          .values({
            hoat_chat: contra.hoat_chat,
            dieu_kien: contra.dieu_kien,
            loai: contra.loai || '',
            muc_do: contra.muc_do || '',
            ly_do_ngan_gon: contra.ly_do_ngan_gon || '',
            embedding: embedding,
          });
      }

      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã lưu chống chỉ định thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error saving contraindication:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  app.delete('/api/admin/contraindications/:id', requireFirebaseUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(contraindications).where(eq(contraindications.id, id));
      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã xóa chống chỉ định thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error deleting contraindication:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 3. MAX DOSES
  app.post('/api/admin/max-doses', requireFirebaseUser, async (req, res) => {
    try {
      const md = req.body;
      if (!md || !md.hoat_chat || !md.nhom_tuoi || md.max_mg_ngay === undefined) {
        return res.status(400).json({ success: false, error: 'Thiếu thông tin liều lượng tối đa.' });
      }

      if (md.id) {
        // Update
        await db.update(maxDoses)
          .set({
            hoat_chat: md.hoat_chat,
            nhom_tuoi: md.nhom_tuoi,
            max_mg_ngay: Number(md.max_mg_ngay),
          })
          .where(eq(maxDoses.id, Number(md.id)));
      } else {
        // Insert
        await db.insert(maxDoses)
          .values({
            hoat_chat: md.hoat_chat,
            nhom_tuoi: md.nhom_tuoi,
            max_mg_ngay: Number(md.max_mg_ngay),
          });
      }

      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã lưu liều lượng tối đa thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error saving max dose:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  app.delete('/api/admin/max-doses/:id', requireFirebaseUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(maxDoses).where(eq(maxDoses.id, id));
      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã xóa giới hạn liều tối đa thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error deleting max dose:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  // 4. RED FLAGS
  app.post('/api/admin/red-flags', requireFirebaseUser, async (req, res) => {
    try {
      const rf = req.body;
      if (!rf || !rf.tu_khoa_trieu_chung) {
        return res.status(400).json({ success: false, error: 'Thiếu triệu chứng cảnh báo.' });
      }

      const embedding = await getEmbedding(rf.tu_khoa_trieu_chung);

      if (rf.id) {
        // Update
        await db.update(redFlags)
          .set({
            tu_khoa_trieu_chung: rf.tu_khoa_trieu_chung,
            muc_do: rf.muc_do || '',
            hanh_dong: rf.hanh_dong || '',
            thong_diep: rf.thong_diep || '',
            embedding: embedding,
          })
          .where(eq(redFlags.id, Number(rf.id)));
      } else {
        // Insert
        await db.insert(redFlags)
          .values({
            tu_khoa_trieu_chung: rf.tu_khoa_trieu_chung,
            muc_do: rf.muc_do || '',
            hanh_dong: rf.hanh_dong || '',
            thong_diep: rf.thong_diep || '',
            embedding: embedding,
          });
      }

      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã lưu triệu chứng cảnh báo nguy hiểm thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error saving red flag:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  app.delete('/api/admin/red-flags/:id', requireFirebaseUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      await db.delete(redFlags).where(eq(redFlags.id, id));
      await reloadSafetyDataFromPostgres();
      return res.json({ success: true, message: 'Đã xóa dấu hiệu cảnh báo thành công!' });
    } catch (err: any) {
      console.error('[Admin API] Error deleting red flag:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  app.get('/api/cart', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    if (!req.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    try {
      const items = await readCart(req.userId);
      return res.json({ success: true, items });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.get('/api/health-profile', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    if (!req.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    try {
      const result = await readHealthProfile(req.userId);
      return res.json({ success: true, profile: result.profile || {} });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/cart/mutate', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    const operation = req.body?.operation as CartOperation | undefined;
    const origin = req.body?.origin as 'manual_catalog' | 'voice_ai' | undefined;
    if (!req.userId || !operation || !['add', 'remove', 'set_quantity', 'clear'].includes(operation.type)) return res.status(400).json({ success: false, error: 'Invalid cart mutation' });
    const result = await mutateCart(req.userId, operation, origin || 'manual_catalog');
    return res.status(result.success ? 200 : 409).json(result);
  });

  app.post('/api/cart/checkout', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    if (!req.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const customer = {
      name: String(req.body?.customer?.name || '').slice(0, 120),
      phone: String(req.body?.customer?.phone || '').slice(0, 40),
      address: String(req.body?.customer?.address || '').slice(0, 300),
    };
    try {
      const cartItems = await readCart(req.userId);
      const profileRes = await readHealthProfile(req.userId);
      const profile = profileRes.profile || {};
      const result = await checkoutCart(req.userId, customer);
      if (result.success && result.orderId) {
        const id = `#${result.orderId}`;
        const timestamp = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        
        const newOrder = {
          id,
          docId: result.orderId,
          userId: req.userId,
          timestamp,
          patientName: customer.name,
          patientAge: Number(profile.do_tuoi || profile.nhom_tuoi || 60),
          patientPhone: customer.phone,
          patientAddress: customer.address,
          priority: 'Tiêu chuẩn',
          status: 'cho_duyet',
          voiceTranscript: cartItems.length > 0 ? (cartItems[0].source || '') : '',
          clinicalSummary: {
            gender: profile.gender || 'Nam',
            age: Number(profile.do_tuoi || profile.nhom_tuoi || 60),
            medicalHistory: profile.benh_nen ? (Array.isArray(profile.benh_nen) ? profile.benh_nen : String(profile.benh_nen).split(',').map((s: string) => s.trim())) : [],
            symptoms: 'Đặt hàng mới qua Voice Shopping App.',
            aiTriage: {
              category: 'Voice Shopping Order (Live)',
              riskLevel: result.verdict === 'WARN' ? 'Trung bình' : 'Thấp',
              note: result.reason || 'Sức khỏe bình thường.',
            },
          },
          items: cartItems,
          processingTimeSeconds: 10,
          notes: '',
          totalPrice: cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0),
          createdAt: new Date().toISOString(),
        };
        previewOrders.set(id, newOrder);
      }
      return res.status(result.success ? 200 : 409).json(result);
    } catch (err: any) {
      console.error('Checkout endpoint error:', err);
      return res.status(500).json({ success: false, error: err.message || String(err) });
    }
  });

  app.post('/api/health-profile', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    if (!req.userId || !req.body?.confirmed) return res.status(400).json({ success: false, error: 'Explicit confirmation is required' });
    const input = req.body.profile && typeof req.body.profile === 'object' ? req.body.profile as Record<string, unknown> : {};
    
    const rawHoTen = String(input.ho_ten || input.customerName || input.name || '').slice(0, 120);
    const rawBenhNen = String(input.benh_nen || input.conditions || '').slice(0, 500);
    const rawDoiTuong = String(input.doi_tuong || '').slice(0, 500);
    const rawDiUng = String(input.di_ung || '').slice(0, 500);
    const rawNhomTuoi = String(input.nhom_tuoi || '').slice(0, 500);
    const rawDoTuoi = String(input.do_tuoi || '').slice(0, 500);
    const rawGhiChu = String(input.ghi_chu_suckhoe || '').slice(0, 500);

    const mappedAge = mapToAgeGroup(rawDoTuoi || rawNhomTuoi);

    const profile: Record<string, unknown> = {
      ho_ten: rawHoTen,
      benh_nen: rawBenhNen,
      doi_tuong: rawDoiTuong,
      di_ung: rawDiUng,
      nhom_tuoi: mappedAge.nhom_tuoi || rawNhomTuoi || 'nguoi_lon',
      do_tuoi: mappedAge.do_tuoi || rawDoTuoi || rawNhomTuoi || '',
      ghi_chu_suckhoe: rawGhiChu,
    };

    try {
      await saveHealthProfile(req.userId, profile);
      return res.json({ success: true, profile });
    } catch (error) {
      return res.status(503).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // In-memory fallback for orders in preview mode when Firestore permissions are restricted
  const previewOrders = new Map<string, any>();

  // Get orders of the authenticated user
  app.get('/api/my-orders', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    if (!req.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    try {
      const { adminDb } = await import('./server/firebaseAdmin.js');
      const snapshot = await adminDb.collection('orders').where('userId', '==', req.userId).get();
      let userProfile: any = null;
      try {
        const pSnap = await adminDb.collection('health_profiles').doc(req.userId).get();
        if (pSnap.exists) userProfile = pSnap.data();
      } catch (pErr) {
        console.warn('Could not read user health profile:', pErr);
      }

      const orders = snapshot.docs.map((doc) => {
        const data = doc.data();
        const id = data.id || `#${doc.id}`;
        const ageVal = data.patientAge || data.clinicalSummary?.age || userProfile?.do_tuoi || userProfile?.nhom_tuoi || 0;
        const nameVal = data.patientName || data.customer?.name || userProfile?.ho_ten || 'Khách hàng';

        const medHistory = data.clinicalSummary?.medicalHistory?.length ? data.clinicalSummary.medicalHistory : (userProfile?.benh_nen ? (Array.isArray(userProfile.benh_nen) ? userProfile.benh_nen : [userProfile.benh_nen]) : []);
        const allergies = data.clinicalSummary?.allergies?.length ? data.clinicalSummary.allergies : (userProfile?.di_ung ? (Array.isArray(userProfile.di_ung) ? userProfile.di_ung : [userProfile.di_ung]) : []);
        const currentMeds = data.clinicalSummary?.currentMeds?.length ? data.clinicalSummary.currentMeds : (userProfile?.thuoc_dang_dung ? (Array.isArray(userProfile.thuoc_dang_dung) ? userProfile.thuoc_dang_dung : [userProfile.thuoc_dang_dung]) : []);
        const specialConditions = data.clinicalSummary?.specialConditions?.length ? data.clinicalSummary.specialConditions : (userProfile?.trang_thai_dac_biet ? (Array.isArray(userProfile.trang_thai_dac_biet) ? userProfile.trang_thai_dac_biet : [userProfile.trang_thai_dac_biet]) : []);
        const symptoms = data.clinicalSummary?.symptoms || data.confirmedTranscript || '';

        const calculatedTriage = computeOrderTriageScore({
          age: ageVal,
          medicalHistory: medHistory,
          allergies,
          currentMeds,
          specialConditions,
          symptoms,
          safetyVerdict: data.safetyVerdict,
          safetyReason: data.safetyReason,
          items: data.items || [],
        });

        const riskScore = typeof data.riskScore === 'number' ? data.riskScore : (data.clinicalSummary?.aiTriage?.riskScore ?? calculatedTriage.riskScore);
        const priorityTier = data.priorityTier || data.clinicalSummary?.aiTriage?.priorityTier || calculatedTriage.priorityTier;
        const priority = data.priority || calculatedTriage.priority;
        const riskFactors = data.riskFactors || data.clinicalSummary?.aiTriage?.riskFactors || calculatedTriage.riskFactors;

        return {
          id,
          docId: doc.id,
          timestamp: data.timestamp || '08:00',
          patientName: nameVal,
          patientAge: ageVal,
          patientPhone: data.patientPhone || data.customer?.phone || '',
          patientAddress: data.customer?.address || '',
          priority,
          priorityTier,
          riskScore,
          riskFactors,
          status: data.status || 'cho_duyet',
          voiceTranscript: data.voiceTranscript || data.confirmedTranscript || '',
          clinicalSummary: {
            gender: data.clinicalSummary?.gender || userProfile?.doi_tuong || 'Nam',
            age: ageVal,
            medicalHistory: medHistory,
            allergies,
            currentMeds,
            specialConditions,
            healthNotes: data.clinicalSummary?.healthNotes || userProfile?.ghi_chu || '',
            symptoms,
            aiTriage: {
              category: data.clinicalSummary?.aiTriage?.category || 'Chưa phân loại',
              riskLevel: data.clinicalSummary?.aiTriage?.riskLevel || (riskScore >= 65 ? 'Cao' : riskScore >= 30 ? 'Trung bình' : 'Thấp'),
              note: data.clinicalSummary?.aiTriage?.note || '',
              riskScore,
              priorityTier,
              riskFactors,
            },
          },
          items: data.items || [],
          processingTimeSeconds: data.processingTimeSeconds || 10,
          notes: data.notes || '',
          totalPrice: data.totalPrice || 0,
          createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null,
        };
      });

      // Sort my-orders by createdAt descending
      orders.sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });

      return res.json({ success: true, orders });
    } catch (error) {
      console.warn('[MyOrdersService] Firestore reading error, serving in-memory filtered orders.');
      const userOrders = Array.from(previewOrders.values()).filter(o => o.userId === req.userId);
      return res.json({ success: true, orders: userOrders });
    }
  });

  // REST endpoints for Orders managing (reads/writes bypassed to Firestore orders collection securely via Admin SDK)
  app.get('/api/orders', async (_req, res) => {
    try {
      const { adminDb } = await import('./server/firebaseAdmin.js');
      const snapshot = await adminDb.collection('orders').get();

      const userIds = [...new Set(snapshot.docs.map(d => d.data().userId).filter(Boolean))];
      const profilesMap = new Map<string, any>();
      if (userIds.length > 0) {
        try {
          const pSnaps = await Promise.all(userIds.map(uid => adminDb.collection('health_profiles').doc(uid).get()));
          for (const pSnap of pSnaps) {
            if (pSnap.exists) profilesMap.set(pSnap.id, pSnap.data());
          }
        } catch (pErr) {
          console.warn('Could not fetch profiles for orders list:', pErr);
        }
      }

      const orders = snapshot.docs.map((doc) => {
        const data = doc.data();
        const id = data.id || `#${doc.id}`;
        const uProfile = data.userId ? profilesMap.get(data.userId) : null;
        const ageVal = data.patientAge || data.clinicalSummary?.age || uProfile?.do_tuoi || uProfile?.nhom_tuoi || 0;
        const nameVal = data.patientName || data.customer?.name || uProfile?.ho_ten || 'Khách hàng';

        const medHistory = data.clinicalSummary?.medicalHistory?.length ? data.clinicalSummary.medicalHistory : (uProfile?.benh_nen ? (Array.isArray(uProfile.benh_nen) ? uProfile.benh_nen : [uProfile.benh_nen]) : []);
        const allergies = data.clinicalSummary?.allergies?.length ? data.clinicalSummary.allergies : (uProfile?.di_ung ? (Array.isArray(uProfile.di_ung) ? uProfile.di_ung : [uProfile.di_ung]) : []);
        const currentMeds = data.clinicalSummary?.currentMeds?.length ? data.clinicalSummary.currentMeds : (uProfile?.thuoc_dang_dung ? (Array.isArray(uProfile.thuoc_dang_dung) ? uProfile.thuoc_dang_dung : [uProfile.thuoc_dang_dung]) : []);
        const specialConditions = data.clinicalSummary?.specialConditions?.length ? data.clinicalSummary.specialConditions : (uProfile?.trang_thai_dac_biet ? (Array.isArray(uProfile.trang_thai_dac_biet) ? uProfile.trang_thai_dac_biet : [uProfile.trang_thai_dac_biet]) : []);
        const symptoms = data.clinicalSummary?.symptoms || data.confirmedTranscript || '';

        const calculatedTriage = computeOrderTriageScore({
          age: ageVal,
          medicalHistory: medHistory,
          allergies,
          currentMeds,
          specialConditions,
          symptoms,
          safetyVerdict: data.safetyVerdict,
          safetyReason: data.safetyReason,
          items: data.items || [],
        });

        const riskScore = typeof data.riskScore === 'number' ? data.riskScore : (data.clinicalSummary?.aiTriage?.riskScore ?? calculatedTriage.riskScore);
        const priorityTier = data.priorityTier || data.clinicalSummary?.aiTriage?.priorityTier || calculatedTriage.priorityTier;
        const priority = data.priority || calculatedTriage.priority;
        const riskFactors = data.riskFactors || data.clinicalSummary?.aiTriage?.riskFactors || calculatedTriage.riskFactors;

        const item = {
          id,
          docId: doc.id,
          userId: data.userId || null,
          timestamp: data.timestamp || '08:00',
          patientName: nameVal,
          patientAge: ageVal,
          patientPhone: data.patientPhone || data.customer?.phone || '',
          patientAddress: data.customer?.address || '',
          priority,
          priorityTier,
          riskScore,
          riskFactors,
          status: data.status || 'cho_duyet',
          voiceTranscript: data.voiceTranscript || data.confirmedTranscript || '',
          clinicalSummary: {
            gender: data.clinicalSummary?.gender || uProfile?.doi_tuong || 'Nam',
            age: ageVal,
            medicalHistory: medHistory,
            allergies,
            currentMeds,
            specialConditions,
            healthNotes: data.clinicalSummary?.healthNotes || uProfile?.ghi_chu || '',
            symptoms,
            aiTriage: {
              category: data.clinicalSummary?.aiTriage?.category || 'Chưa phân loại',
              riskLevel: data.clinicalSummary?.aiTriage?.riskLevel || (riskScore >= 65 ? 'Cao' : riskScore >= 30 ? 'Trung bình' : 'Thấp'),
              note: data.clinicalSummary?.aiTriage?.note || '',
              riskScore,
              priorityTier,
              riskFactors,
            },
          },
          items: data.items || [],
          processingTimeSeconds: data.processingTimeSeconds || 10,
          notes: data.notes || '',
          totalPrice: data.totalPrice || 0,
          createdAt: data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toISOString() : data.createdAt) : null,
        };
        previewOrders.set(id, item);
        return item;
      });
      // Sort orders by createdAt descending
      orders.sort((a, b) => {
        const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tB - tA;
      });
      return res.json({ success: true, orders });
    } catch (error) {
      console.warn('[OrdersService] Firestore error in preview mode, serving in-memory orders fallback.');
      const allOrders = Array.from(previewOrders.values());
      return res.json({ success: true, orders: allOrders });
    }
  });

  app.post('/api/orders', async (req, res) => {
    const order = req.body;
    if (!order || !order.id) {
      return res.status(400).json({ success: false, error: 'Dữ liệu đơn hàng không hợp lệ' });
    }
    const cleanId = String(order.id);
    previewOrders.set(cleanId, order);
    try {
      const { adminDb, FieldValue, SERVER_SECRET } = await import('./server/firebaseAdmin.js');
      const docId = cleanId.replace('#', '');
      await adminDb.collection('orders').doc(docId).set({
        ...order,
        serverSecret: SERVER_SECRET,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.warn('[OrdersService] Firestore save error in preview mode, kept in-memory order.');
    }
    return res.json({ success: true });
  });

  app.post('/api/orders/:id/approve', async (req, res) => {
    const { id } = req.params;
    if (previewOrders.has(id)) {
      previewOrders.get(id).status = 'duoc_duyet';
    }
    try {
      const { adminDb, SERVER_SECRET } = await import('./server/firebaseAdmin.js');
      const docId = id.replace('#', '');
      await adminDb.collection('orders').doc(docId).update({
        status: 'duoc_duyet',
        serverSecret: SERVER_SECRET,
      });
    } catch (error) {
      console.warn('[OrdersService] Firestore update error in preview mode, updated in-memory.');
    }
    return res.json({ success: true });
  });

  app.post('/api/orders/:id/pay', async (req, res) => {
    const { id } = req.params;
    
    if (previewOrders.has(id)) {
      const order = previewOrders.get(id);
      if (order.status !== 'duoc_duyet' && order.status !== 'approved') {
        return res.status(400).json({ success: false, error: 'Chỉ đơn hàng đã được phê duyệt mới có thể thanh toán.' });
      }
      order.status = 'da_thanh_toan';
    }

    try {
      const { adminDb, SERVER_SECRET } = await import('./server/firebaseAdmin.js');
      const docId = id.replace('#', '');
      const docRef = adminDb.collection('orders').doc(docId);
      const docSnap = await docRef.get();
      
      if (docSnap.exists) {
        const data = docSnap.data();
        if (data && data.status !== 'duoc_duyet' && data.status !== 'approved') {
          return res.status(400).json({ success: false, error: 'Chỉ đơn hàng đã được phê duyệt mới có thể thanh toán.' });
        }
      }

      await docRef.update({
        status: 'da_thanh_toan',
        serverSecret: SERVER_SECRET,
      });
    } catch (error) {
      console.warn('[OrdersService] Firestore update error in preview mode, updated in-memory.');
    }
    return res.json({ success: true });
  });

  app.post('/api/orders/:id/cancel-and-call', async (req, res) => {
    const { id } = req.params;
    if (previewOrders.has(id)) {
      const existing = previewOrders.get(id);
      existing.status = 'da_huy';
      existing.priority = 'Cần gọi';
    }
    try {
      const { adminDb, SERVER_SECRET } = await import('./server/firebaseAdmin.js');
      const docId = id.replace('#', '');
      await adminDb.collection('orders').doc(docId).update({
        status: 'da_huy',
        priority: 'Cần gọi',
        serverSecret: SERVER_SECRET,
      });
    } catch (error) {
      console.warn('[OrdersService] Firestore update error in preview mode, updated in-memory.');
    }
    return res.json({ success: true });
  });

  app.post('/api/orders/:id/items', async (req, res) => {
    const { id } = req.params;
    const { items } = req.body;
    if (previewOrders.has(id)) {
      previewOrders.get(id).items = items;
    }
    try {
      const { adminDb, SERVER_SECRET } = await import('./server/firebaseAdmin.js');
      const docId = id.replace('#', '');
      await adminDb.collection('orders').doc(docId).update({
        items,
        serverSecret: SERVER_SECRET,
      });
    } catch (error) {
      console.warn('[OrdersService] Firestore update error in preview mode, updated in-memory.');
    }
    return res.json({ success: true });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true, host: '0.0.0.0', port }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const clientPath = path.join(process.cwd(), 'dist', 'client');
    app.use(express.static(clientPath));
    app.get('*', (_req, res) => res.sendFile(path.join(clientPath, 'index.html')));
  }

  httpServer.listen(port, '0.0.0.0', () => console.log(`[Server] VietMed Care AI running on http://0.0.0.0:${port}`));
}

startServer().catch((error) => {
  console.error('[Server] Fatal startup error:', error);
  process.exitCode = 1;
});
