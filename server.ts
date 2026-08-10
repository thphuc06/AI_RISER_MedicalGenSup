import './server/env.js';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer } from 'ws';
import { requireFirebaseUser, type AuthenticatedRequest } from './server/auth.js';
import { checkoutCart, mutateCart, saveHealthProfile, readCart, readHealthProfile, type CartOperation } from './server/cartService.js';
import { setupLiveAgentWebSocket } from './server/liveAgentHandler.js';
import { getCacheStatus, getContraindications, getMaxDoses, getProducts, getRedFlags, getValidAgeGroups, getValidConditions, loadAllSheets, startPeriodicRefresh } from './server/sheetsService.js';

const EXPECTED_PROJECT_ID = 'project-c55c421d-248e-4800-bfb';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

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
    if (!req.userId || !operation || !['add', 'remove', 'set_quantity', 'clear'].includes(operation.type)) return res.status(400).json({ success: false, error: 'Invalid cart mutation' });
    const result = await mutateCart(req.userId, operation);
    return res.status(result.success ? 200 : 409).json(result);
  });

  app.post('/api/cart/checkout', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    if (!req.userId) return res.status(401).json({ success: false, error: 'Authentication required' });
    const result = await checkoutCart(req.userId, {
      name: String(req.body?.customer?.name || '').slice(0, 120), phone: String(req.body?.customer?.phone || '').slice(0, 40), address: String(req.body?.customer?.address || '').slice(0, 300),
    });
    return res.status(result.success ? 200 : 409).json(result);
  });

  app.post('/api/health-profile', requireFirebaseUser, async (req: AuthenticatedRequest, res) => {
    if (!req.userId || !req.body?.confirmed) return res.status(400).json({ success: false, error: 'Explicit confirmation is required' });
    const input = req.body.profile && typeof req.body.profile === 'object' ? req.body.profile as Record<string, unknown> : {};
    const profile = Object.fromEntries(['benh_nen', 'doi_tuong', 'di_ung', 'nhom_tuoi', 'do_tuoi', 'ghi_chu_suckhoe'].filter((field) => typeof input[field] === 'string').map((field) => [field, String(input[field]).slice(0, 500)]));
    const conditionValues = ['benh_nen', 'doi_tuong'].flatMap((field) => String(profile[field] || '').split(/[;,]/).map((item) => item.trim().toLowerCase()).filter(Boolean));
    if (conditionValues.some((value) => !getValidConditions().includes(value))) return res.status(400).json({ success: false, error: 'Bệnh nền/đối tượng phải dùng đúng mã điều kiện từ dữ liệu an toàn.' });
    if (profile.nhom_tuoi && !getValidAgeGroups().includes(profile.nhom_tuoi.toLowerCase())) return res.status(400).json({ success: false, error: 'Nhóm tuổi không tồn tại trong Max_Dose.' });
    try {
      await saveHealthProfile(req.userId, profile);
      return res.json({ success: true });
    } catch (error) {
      return res.status(503).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // REST endpoints for Orders managing (reads/writes bypassed to Firestore orders collection securely via Admin SDK)
  app.get('/api/orders', async (_req, res) => {
    try {
      const { adminDb } = await import('./server/firebaseAdmin.js');
      const snapshot = await adminDb.collection('orders').get();
      const orders = snapshot.docs.map((doc) => {
        const data = doc.data();
        const id = data.id || `#${doc.id}`;
        return {
          id,
          timestamp: data.timestamp || '08:00',
          patientName: data.patientName || 'Khách hàng',
          patientAge: data.patientAge || data.clinicalSummary?.age || 0,
          patientPhone: data.patientPhone || '',
          priority: data.priority || 'Tiêu chuẩn',
          status: data.status || 'pending',
          voiceTranscript: data.voiceTranscript || data.confirmedTranscript || '',
          clinicalSummary: {
            gender: data.clinicalSummary?.gender || 'Nam',
            age: data.clinicalSummary?.age || data.patientAge || 0,
            medicalHistory: data.clinicalSummary?.medicalHistory || [],
            symptoms: data.clinicalSummary?.symptoms || '',
            aiTriage: {
              category: data.clinicalSummary?.aiTriage?.category || 'Chưa phân loại',
              riskLevel: data.clinicalSummary?.aiTriage?.riskLevel || 'Thấp',
              note: data.clinicalSummary?.aiTriage?.note || '',
            },
          },
          items: data.items || [],
          processingTimeSeconds: data.processingTimeSeconds || 10,
          notes: data.notes || '',
          totalPrice: data.totalPrice || 0,
        };
      });
      return res.json({ success: true, orders });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/orders', async (req, res) => {
    try {
      const order = req.body;
      if (!order || !order.id) {
        return res.status(400).json({ success: false, error: 'Dữ liệu đơn hàng không hợp lệ' });
      }
      const { adminDb, FieldValue } = await import('./server/firebaseAdmin.js');
      const docId = order.id.replace('#', '');
      await adminDb.collection('orders').doc(docId).set({
        ...order,
        createdAt: FieldValue.serverTimestamp(),
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/orders/:id/approve', async (req, res) => {
    try {
      const { id } = req.params;
      const { adminDb } = await import('./server/firebaseAdmin.js');
      const docId = id.replace('#', '');
      await adminDb.collection('orders').doc(docId).update({
        status: 'approved',
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/orders/:id/cancel-and-call', async (req, res) => {
    try {
      const { id } = req.params;
      const { adminDb } = await import('./server/firebaseAdmin.js');
      const docId = id.replace('#', '');
      await adminDb.collection('orders').doc(docId).update({
        status: 'calling',
        priority: 'Cần gọi',
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
  });

  app.post('/api/orders/:id/items', async (req, res) => {
    try {
      const { id } = req.params;
      const { items } = req.body;
      const { adminDb } = await import('./server/firebaseAdmin.js');
      const docId = id.replace('#', '');
      await adminDb.collection('orders').doc(docId).update({
        items,
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: String(error) });
    }
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
