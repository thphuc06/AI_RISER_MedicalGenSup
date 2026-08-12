import React, { useState, useEffect, useRef } from 'react';
import { ThreeMicSphere } from './ThreeMicSphere';
import { CartItem, VoicePreset } from '../types';
import { VOICE_PRESETS } from '../data/mockData';
import { checkoutServerCart, mutateServerCart, subscribeToCart, fetchCartFromServer } from '../services/cartService';
import {
  subscribeToHealthProfile,
  saveHealthProfile,
  fetchHealthProfileFromServer,
  HealthProfile,
} from '../services/healthProfileService';
import { auth, ensureAuthenticatedUser, signInWithGoogle, logoutUser } from '../firebase';
import { onAuthStateChanged, User, updateProfile } from 'firebase/auth';
import { LiveAgentClient } from '../services/liveAgentClient';
import { formatConditionToVietnamese, formatAgeDisplay } from '../utils/formatters';

export function cleanAccumulatedTranscript(text: string): string {
  let cleaned = text;

  // 1. Remove completed call/response blocks with brace matching
  const pattern = /(?:call|response):[a-zA-Z0-9_]+\s*\{/g;
  let match;

  while ((match = pattern.exec(cleaned)) !== null) {
    const startIndex = match.index;
    let braceCount = 0;
    let endIndex = -1;

    for (let i = startIndex; i < cleaned.length; i++) {
      if (cleaned[i] === '{') {
        braceCount++;
      } else if (cleaned[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex !== -1) {
      cleaned = cleaned.slice(0, startIndex) + cleaned.slice(endIndex + 1);
      pattern.lastIndex = 0; // Reset regex index since string was modified
    } else {
      // Incomplete block, strip everything from startIndex to the end of the string
      cleaned = cleaned.slice(0, startIndex);
      break;
    }
  }

  // 2. Remove any trailing/incomplete call: or response: prefixes that haven't even opened a brace yet
  const incompletePattern = /(?:call|response):[a-zA-Z0-9_]*$/i;
  cleaned = cleaned.replace(incompletePattern, '');

  return cleaned.trim();
}

interface VoiceShoppingCustomerProps {
  onSendOrderToPharmacist?: (cartItems: CartItem[], transcript: string) => void;
  onSwitchToPharmacistView?: () => void;
}

export const VoiceShoppingCustomer: React.FC<VoiceShoppingCustomerProps> = ({
  onSendOrderToPharmacist,
  onSwitchToPharmacistView,
}) => {
  const [activePreset, setActivePreset] = useState<VoicePreset>(VOICE_PRESETS[0]);
  const [transcript, setTranscript] = useState<string>(
    'Tôi muốn mua thuốc cảm cúm cho người già.'
  );
  const [aiResponseText, setAiResponseText] = useState<string>('');
  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('Đang kết nối Gemini Live API...');
  const [notification, setNotification] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [showDomainErrorHelp, setShowDomainErrorHelp] = useState(false);
  const [showPopupBlockedHelp, setShowPopupBlockedHelp] = useState(false);

  // Health Profile State
  const [healthProfile, setHealthProfile] = useState<HealthProfile>({});
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState(false);

  const clientRef = useRef<LiveAgentClient | null>(null);
  const rawAiResponseRef = useRef<string>('');

  // Cart items state initialized empty by default
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Connect only after Firebase authentication, so the server can bind all actions to the real uid.
  useEffect(() => {
    if (!user) return;
    const liveClient = new LiveAgentClient({
      onSessionReady: () => {
        setIsConnected(true);
        setStatusMessage('Đã kết nối Gemini Live. Giữ mic để nói!');
      },
      onInputTranscript: (text) => {
        setTranscript(text);
        setStatusMessage('👉 Đã nhận diện câu nói: "' + text + '" - Dược sĩ AI đang xử lý tự động...');
      },
      onOutputTranscript: (text) => {
        rawAiResponseRef.current = rawAiResponseRef.current ? rawAiResponseRef.current + ' ' + text : text;
        setAiResponseText(cleanAccumulatedTranscript(rawAiResponseRef.current));
      },
      onCartAction: (_action, reason) => {
        setNotification(reason ? `Giỏ hàng đã được kiểm tra: ${reason}` : 'Giỏ hàng đã được cập nhật an toàn.');
        setTimeout(() => setNotification(null), 3500);
        fetchCartFromServer(user)
          .then((remoteCart) => {
            if (remoteCart && Array.isArray(remoteCart.items)) {
              setCartItems(remoteCart.items);
            }
          })
          .catch((err) => console.error('[Client] Refetch cart failed:', err));
      },
      onHealthProfileUpdated: (truong, gia_tri) => {
        setHealthProfile((prev) => ({
          ...prev,
          [truong]: gia_tri,
        }));
        const fieldLabel = truong === 'benh_nen' ? 'Bệnh nền' : truong === 'di_ung' ? 'Dị ứng' : (truong === 'do_tuoi' || truong === 'nhom_tuoi' || truong === 'age') ? 'Độ tuổi' : 'Ghi chú';
        const displayVal = (truong === 'do_tuoi' || truong === 'nhom_tuoi' || truong === 'age') ? formatAgeDisplay(gia_tri) : formatConditionToVietnamese(gia_tri);
        setNotification(`📋 Dược sĩ AI vừa tự động ghi nhận hồ sơ: ${fieldLabel} → "${displayVal}"`);
        setTimeout(() => setNotification(null), 5000);
      },
      onEscalate: (reason) => {
        setNotification(`🚨 Chuyển tuyến Dược sĩ: ${reason}`);
        setTimeout(() => {
          if (onSwitchToPharmacistView) onSwitchToPharmacistView();
        }, 2000);
      },
      onInterrupted: () => {
        rawAiResponseRef.current = '';
        setAiResponseText('');
        setStatusMessage('⏹️ AI đã bị ngắt câu trả lời.');
      },
      onError: (err) => {
        console.error('[VoiceShoppingCustomer] Live Agent error:', err);
        setStatusMessage(`⚠️ ${err}`);
        setNotification(`Lỗi Dược sĩ AI: ${err}`);
        setIsConnected(false);
      },
    }, () => user.getIdToken());

    liveClient.connect();
    clientRef.current = liveClient;

    return () => {
      liveClient.disconnect();
    };
  }, [user?.uid]);

  // Establish an isolated Firebase identity. Anonymous Auth is used for demo sessions;
  // Google sign-in upgrades the identity when the user chooses it.
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        if (currentUser.displayName) {
          setCustomerName(currentUser.displayName);
        }
      } else {
        ensureAuthenticatedUser()
          .then((fallbackUser) => {
            setUser(fallbackUser);
            if (fallbackUser?.displayName) {
              setCustomerName(fallbackUser.displayName);
            }
          })
          .catch((err: any) => {
            console.error('ensureAuthenticatedUser error:', err);
            const isDomainError = err.message?.includes('unauthorized-domain') || String(err).includes('unauthorized-domain');
            if (isDomainError) {
              setShowDomainErrorHelp(true);
            }
            setStatusMessage(err.message || 'Vui lòng kích hoạt Anonymous Auth trong Firebase Console.');
            setNotification(err.message || 'Lỗi xác thực người dùng.');
          });
      }
    });
    return unsubscribeAuth;
  }, []);

  useEffect(() => {
    if (!user) return;

    // Fetch initial data immediately using the REST fallback
    fetchCartFromServer(user)
      .then((remoteCart) => {
        if (remoteCart && Array.isArray(remoteCart.items)) {
          setCartItems(remoteCart.items);
        }
      })
      .catch((err) => console.warn('Initial server cart fetch failed, relying on Firestore:', err));

    fetchHealthProfileFromServer(user)
      .then((profile) => {
        if (profile) {
          setHealthProfile(profile);
          if (profile.ho_ten) {
            setCustomerName(profile.ho_ten);
          }
        }
      })
      .catch((err) => console.warn('Initial server health profile fetch failed, relying on Firestore:', err));

    // Also subscribe via Firestore as realtime backup
    const unsubscribeCart = subscribeToCart(user.uid, (remoteCart) => {
      if (remoteCart && Array.isArray(remoteCart.items)) {
        setCartItems(remoteCart.items);
      }
    }, (err) => {
      console.warn('Firestore cart subscription failed, using REST fallback only.', err);
    });

    const unsubscribeHealth = subscribeToHealthProfile(user.uid, (profile) => {
      if (profile) {
        setHealthProfile(profile);
        if (profile.ho_ten) {
          setCustomerName(profile.ho_ten);
        }
      }
    }, (err) => {
      console.warn('Firestore health profile subscription failed, using REST fallback only.', err);
    });

    return () => {
      unsubscribeCart();
      unsubscribeHealth();
    };
  }, [user?.uid]);

  const [activeTab, setActiveTab] = useState<'home' | 'products' | 'prescriptions' | 'profile'>('home');
  const [products, setProducts] = useState<any[]>([]);
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState<boolean>(false);
  const [prescFilter, setPrescFilter] = useState<'all' | 'cho_duyet' | 'duoc_duyet' | 'da_huy' | 'da_thanh_toan'>('all');

  const fetchMyOrders = async () => {
    if (!user) return;
    setIsLoadingOrders(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/my-orders', {
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.success) {
        setMyOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Error fetching user orders:', err);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  useEffect(() => {
    if (user && activeTab === 'prescriptions') {
      fetchMyOrders();
    }
  }, [user, activeTab]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch('/api/pharmacy/products');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setProducts(data.data);
        }
      } catch (err) {
        console.error('Error fetching sheets products:', err);
      }
    };
    fetchProducts();
  }, []);

  const handleAddProductToCart = async (prod: any) => {
    if (!user) return;
    try {
      await mutateServerCart(user, {
        type: 'add',
        sku: prod.sku,
        quantity: 1,
        source: 'Chọn từ danh mục'
      }, 'manual_catalog');
      setNotification(`🛒 Đã thêm ${prod.ten_san_pham} vào giỏ hàng`);
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.warn('[Safety Check] Prevented duplicate or unsafe item addition:', err);
      setNotification(`⚠️ ${err instanceof Error ? err.message : 'Không thể thêm vào giỏ hàng'}`);
      setTimeout(() => setNotification(null), 5000);
    }
  };

  const [currentProductPage, setCurrentProductPage] = useState(1);
  const PRODUCTS_PER_PAGE = 5;

  useEffect(() => {
    setCurrentProductPage(1);
  }, [productSearchQuery]);

  const filteredProducts = products.filter((p) => {
    const term = productSearchQuery.toLowerCase();
    return (
      p.ten_san_pham?.toLowerCase().includes(term) ||
      p.hoat_chat?.toLowerCase().includes(term) ||
      p.sku?.toLowerCase().includes(term)
    );
  });

  const totalProductPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE) || 1;
  const paginatedProducts = filteredProducts.slice(
    (currentProductPage - 1) * PRODUCTS_PER_PAGE,
    currentProductPage * PRODUCTS_PER_PAGE
  );

  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);

  // Address form
  const [customerName, setCustomerName] = useState('Trần Văn Nam');
  const [customerPhone, setCustomerPhone] = useState('0903 123 456');
  const [customerAddress, setCustomerAddress] = useState('123 Nguyễn Trãi, Quận 1, TP. Hồ Chí Minh');

  const updateQuantity = async (id: string, delta: number) => {
    if (!user) return;
    const item = cartItems.find((candidate) => candidate.id === id);
    if (!item) return;
    const quantity = item.quantity + delta;
    try {
      await mutateServerCart(user, quantity > 0 ? { type: 'set_quantity', sku: id, quantity } : { type: 'remove', sku: id });
    } catch (err) {
      setNotification(err instanceof Error ? err.message : 'Không thể cập nhật giỏ hàng');
    }
  };

  const removeItem = async (id: string) => {
    if (!user) return;
    try {
      await mutateServerCart(user, { type: 'remove', sku: id });
      setNotification('🗑️ Đã xóa sản phẩm khỏi giỏ hàng & đồng bộ Firestore');
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error('Error removing item from Firestore:', err);
    }
  };

  const clearAllCartItems = async () => {
    if (!user) return;
    try {
      await mutateServerCart(user, { type: 'clear' });
      setNotification('🧹 Đã xóa sạch giỏ hàng trên Database Firestore');
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error('Error clearing cart in Firestore:', err);
    }
  };

  const calculateTotal = () => {
    return cartItems.reduce(
      (sum, item) => sum + (item.isDisabled ? 0 : item.price * item.quantity),
      0
    );
  };

  const handleSelectPreset = async (preset: VoicePreset) => {
    setActivePreset(preset);
    setTranscript(preset.transcript);
    rawAiResponseRef.current = '';
    setAiResponseText('');
  };

  const handleStopAiSpeaking = () => {
    if (clientRef.current) {
      clientRef.current.stopAudioOutput();
    }
    rawAiResponseRef.current = '';
    setAiResponseText('');
    setStatusMessage('⏹️ Đã dừng Dược sĩ AI phát âm thanh.');
    setNotification('🔇 Đã tắt âm thanh Dược sĩ AI');
    setTimeout(() => setNotification(null), 3000);
  };

  const handleClearConversation = () => {
    if (clientRef.current) {
      clientRef.current.stopAudioOutput();
      clientRef.current.stopRecording();
    }
    setIsListening(false);
    setTranscript('');
    rawAiResponseRef.current = '';
    setAiResponseText('');
    setStatusMessage('🧹 Đã xóa cuộc hội thoại. Hãy bấm nút mic để bắt đầu mới.');
    setNotification('🧹 Đã xóa nội dung cuộc hội thoại');
    setTimeout(() => setNotification(null), 3000);
  };

  // REQUIREMENT 2: SEND CONFIRMED/EDITED TRANSCRIPT
  const handleConfirmAndSendTranscript = () => {
    if (!transcript.trim()) return;
    setIsEditingTranscript(false);

    if (/(dừng lại|ngừng nói|im lặng|tắt đi|tắt ai|thôi)/i.test(transcript)) {
      handleStopAiSpeaking();
      return;
    }

    rawAiResponseRef.current = '';
    setAiResponseText('');
    if (clientRef.current) {
      clientRef.current.prepareAudioOutput();
      clientRef.current.sendConfirmedText(transcript);
      setStatusMessage('🤖 Dược sĩ AI đang phân tích và chuẩn bị trả lời bằng giọng nói...');
    }
  };

  // Mic Press / Hold handlers
  const isHoldingRef = useRef(false);
  const pressTimerRef = useRef<any>(null);

  const handleStartMic = async () => {
    if (!clientRef.current) return;
    setIsListening(true);
    rawAiResponseRef.current = '';
    setAiResponseText('');
    setStatusMessage('🎙️ Đang lắng nghe... Hãy nói triệu chứng của bạn');
    await clientRef.current.startRecording();
  };

  const handleStopMic = () => {
    if (!clientRef.current) return;
    setIsListening(false);
    clientRef.current.stopRecording();
    setStatusMessage('✍️ Đã ghi âm xong. Dược sĩ AI đang phân tích và xử lý...');
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    isHoldingRef.current = false;
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);

    pressTimerRef.current = setTimeout(() => {
      isHoldingRef.current = true;
      if (!isListening) {
        handleStartMic();
      }
    }, 200);
  };

  const handlePointerUp = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    if (isHoldingRef.current) {
      handleStopMic();
      setTimeout(() => {
        isHoldingRef.current = false;
      }, 150);
    }
  };

  const handleTapToggle = () => {
    if (isHoldingRef.current) {
      return;
    }
    if (isListening) {
      handleStopMic();
    } else {
      handleStartMic();
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      await checkoutServerCart(user, { name: customerName, phone: customerPhone, address: customerAddress });
      setCheckoutSuccess(true);
      onSendOrderToPharmacist?.(cartItems.filter((i) => !i.isDisabled && i.quantity > 0), transcript);
      setTimeout(() => {
        fetchMyOrders();
      }, 500);
    } catch (error) {
      setNotification(error instanceof Error ? error.message : 'Kiểm tra an toàn cuối cùng thất bại.');
      return;
    }

    setTimeout(() => {
      setShowCheckoutModal(false);
      setCheckoutSuccess(false);
      setActiveTab('prescriptions');
    }, 2500);
  };

  const [profileErrorMsg, setProfileErrorMsg] = useState<string | null>(null);

  const handleSaveHealthProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileErrorMsg(null);
    try {
      if (!user) throw new Error('Vui lòng đăng nhập trước khi lưu hồ sơ.');
      const profileToSave = {
        ...healthProfile,
        ho_ten: customerName,
      };
      await saveHealthProfile(user, profileToSave);
      setHealthProfile(profileToSave);

      if (auth.currentUser && customerName) {
        try {
          await updateProfile(auth.currentUser, { displayName: customerName });
        } catch (authErr) {
          console.warn('Could not update Firebase Auth displayName:', authErr);
        }
      }

      setProfileSavedMsg(true);
      setTimeout(() => setProfileSavedMsg(false), 3000);
    } catch (err: any) {
      console.error('Error saving health profile:', err);
      setProfileErrorMsg(err.message || 'Không thể lưu hồ sơ sức khỏe.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAddQuickTag = (type: 'benh_nen' | 'di_ung' | 'do_tuoi' | 'thuoc_dang_dung', tag: string) => {
    setHealthProfile((prev) => {
      if (type === 'do_tuoi') {
        return { ...prev, do_tuoi: tag, nhom_tuoi: tag };
      }
      const rawVal = prev[type as keyof HealthProfile];
      const currentVal = Array.isArray(rawVal) ? rawVal.join(', ') : (rawVal || '');
      if (String(currentVal).toLowerCase().includes(tag.toLowerCase())) return prev;
      const newVal = currentVal ? `${currentVal}, ${tag}` : tag;
      return { ...prev, [type]: newVal };
    });
  };

  const renderDomainErrorHelp = () => {
    if (!showDomainErrorHelp) return null;
    const currentHost = window.location.host;
    const consoleUrl = 'https://console.firebase.google.com/project/project-c55c421d-248e-4800-bfb/authentication/providers';

    return (
      <div className="mx-4 my-2 p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-3 shadow-xs text-xs text-amber-900 leading-relaxed text-left">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-amber-700 text-lg shrink-0 mt-0.5">warning</span>
          <div>
            <h4 className="font-bold text-amber-800 text-sm">Lỗi cấu hình Firebase Auth</h4>
            <p className="mt-1">
              Nhận được lỗi <strong>unauthorized-domain</strong> vì tên miền này chưa được cấp phép truy cập vào Authentication trong dự án Firebase của bạn.
            </p>
          </div>
        </div>

        <div className="bg-white border border-amber-200 rounded-lg p-2.5 space-y-2">
          <p className="font-semibold text-[11px] text-gray-700">Tên miền cần được thêm:</p>
          <div className="flex items-center justify-between gap-2 bg-gray-50 border border-amber-200 p-1.5 rounded-md font-mono text-[11px] text-gray-800">
            <span className="truncate select-all">{currentHost}</span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(currentHost);
                setNotification('📋 Đã sao chép tên miền vào Clipboard!');
                setTimeout(() => setNotification(null), 3000);
              }}
              className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[10px] font-bold cursor-pointer transition-colors shrink-0"
            >
              Sao chép
            </button>
          </div>
        </div>

        <div className="space-y-1 text-[11px]">
          <p className="font-semibold text-amber-950">Cách khắc phục:</p>
          <ol className="list-decimal pl-4 space-y-1 text-amber-900">
            <li>Mở <strong>Firebase Console</strong> bằng cách nhấp vào nút bên dưới.</li>
            <li>Chọn tab <strong>Settings</strong> &gt; Chọn <strong>Authorized domains</strong>.</li>
            <li>Nhấn <strong>Add domain</strong> và dán tên miền vừa sao chép ở trên vào, sau đó lưu lại.</li>
          </ol>
        </div>

        <div className="pt-1 flex gap-2">
          <a
            href={consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-1.5 px-3 bg-amber-700 text-white text-center font-bold rounded-lg hover:bg-amber-800 transition-colors shadow-2xs text-[11px]"
          >
            Mở Firebase Console
          </a>
          <button
            type="button"
            onClick={() => setShowDomainErrorHelp(false)}
            className="px-2.5 py-1.5 bg-white border border-amber-300 hover:bg-amber-100 text-amber-700 font-semibold rounded-lg transition-colors text-[11px]"
          >
            Ẩn đi
          </button>
        </div>
      </div>
    );
  };

  const renderPopupBlockedHelp = () => {
    if (!showPopupBlockedHelp) return null;
    return (
      <div className="mx-4 my-2 p-3.5 bg-rose-50 border border-rose-300 rounded-xl space-y-3 shadow-xs text-xs text-rose-950 leading-relaxed text-left">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-rose-700 text-lg shrink-0 mt-0.5">warning</span>
          <div>
            <h4 className="font-bold text-rose-800 text-sm">Cửa sổ đăng nhập bị chặn (Popup Blocked)</h4>
            <p className="mt-1">
              Trình duyệt đã chặn cửa sổ đăng nhập Google. Đây là cơ chế bảo mật tiêu chuẩn khi app chạy bên trong khung iFrame (như trên Google AI Studio).
            </p>
          </div>
        </div>

        <div className="bg-white border border-rose-200 rounded-lg p-2.5 space-y-2 text-gray-800 text-[11px]">
          <p className="font-semibold text-rose-950">Cách khắc phục:</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Nhấn nút <strong>"Mở ứng dụng ở Tab riêng / New Tab"</strong> ở trên thanh công cụ AI Studio để chạy app trực tiếp, tránh rào cản iFrame.</li>
            <li>Hoặc bật quyền cho phép cửa sổ bật lên (Popups & Redirects) cho trang web này trong cài đặt trình duyệt rồi nhấn <strong>Đăng nhập</strong> để thử lại.</li>
          </ul>
        </div>

        <div className="pt-1 flex">
          <button
            type="button"
            onClick={() => setShowPopupBlockedHelp(false)}
            className="w-full py-1.5 px-3 bg-rose-700 text-white font-bold rounded-lg hover:bg-rose-800 transition-colors shadow-2xs text-[11px]"
          >
            Tôi đã hiểu, ẩn đi
          </button>
        </div>
      </div>
    );
  };

  const renderAuthErrorHelp = () => {
    if (user) return null;
    return (
      <div className="mx-4 my-2 p-3.5 bg-rose-50 border border-rose-300 rounded-xl space-y-3 shadow-xs text-xs text-rose-950 leading-relaxed text-left">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-rose-700 text-lg shrink-0 mt-0.5">lock_open</span>
          <div>
            <h4 className="font-bold text-rose-800 text-sm">Chưa kích hoạt Anonymous Auth</h4>
            <p className="mt-1">
              Ứng dụng yêu cầu <strong>Đăng nhập ẩn danh (Anonymous Auth)</strong> được bật trong Firebase để tạo phiên làm việc bảo mật và quản lý giỏ hàng/giọng nói.
            </p>
          </div>
        </div>

        <div className="bg-white border border-rose-200 rounded-lg p-2.5 space-y-1.5 text-gray-800 text-[11px]">
          <p className="font-semibold text-rose-950">Cách khắc phục:</p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>Truy cập <strong>Firebase Console</strong> dự án của bạn.</li>
            <li>Chọn <strong>Build &gt; Authentication &gt; Sign-in method</strong>.</li>
            <li>Bật (Enable) nhà cung cấp <strong>Anonymous</strong> rồi lưu lại.</li>
            <li>Tải lại trang web này.</li>
          </ol>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-background text-on-background font-body-md antialiased overflow-hidden flex flex-col h-full w-full relative max-w-md mx-auto border-x border-[#bdc9c5] shadow-2xl">
      {/* TopAppBar */}
      <header className="bg-white text-[#00685c] border-b border-[#bdc9c5] flex justify-between items-center px-4 h-12 w-full z-40 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-[#00685c] text-white flex items-center justify-center">
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
              local_pharmacy
            </span>
          </div>
          <h1 className="text-base font-bold text-[#00685c]">Nhà Thuốc Việt</h1>
        </div>

        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} title={isConnected ? 'Gemini Live Connected' : 'Connecting...'} />
          <span className="text-[11px] font-semibold text-[#00685c]">Gemini Live</span>
        </div>
      </header>

      {/* Floating Realtime Notification Toast */}
      {notification && (
        <div className="absolute top-14 left-4 right-4 z-50 bg-[#00685c] text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center justify-between text-xs font-bold animate-bounce">
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} className="text-white/80 hover:text-white">✕</button>
        </div>
      )}

      {/* Main Layout Content depending on activeTab */}
      <main className="flex-1 flex flex-col overflow-y-auto relative">
        {activeTab === 'home' && (
          <>
            {/* Top Half: Voice Interaction */}
            <section className="flex flex-col items-center justify-center p-4 bg-surface-container-lowest border-b border-surface-dim shadow-sm relative z-10 shrink-0">
              {/* Status Header */}
              <p className="text-[11px] text-gray-500 mb-2 font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">graphic_eq</span> {statusMessage}
              </p>

              {renderDomainErrorHelp()}
              {renderPopupBlockedHelp()}
              {renderAuthErrorHelp()}

              {/* Patient Health Profile Summary Badge on Home Screen */}
              <div className="w-full max-w-sm mb-2 p-2.5 bg-emerald-50/90 border border-emerald-200 rounded-xl shadow-xs text-xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="material-symbols-outlined text-emerald-700 text-lg shrink-0">medical_information</span>
                  <div className="truncate">
                    <p className="font-bold text-emerald-900 truncate">
                      Hồ sơ AI theo dõi: <span className="font-semibold text-emerald-800">{formatConditionToVietnamese(healthProfile.benh_nen) || 'Chưa có bệnh nền'}</span>
                    </p>
                    <p className="text-[11px] text-emerald-700 truncate">
                      Dị ứng: <span className="font-bold text-red-600">{formatConditionToVietnamese(healthProfile.di_ung) || 'Chưa ghi nhận'}</span> | Tuổi: <span className="font-bold text-emerald-900">{formatAgeDisplay(healthProfile.do_tuoi, healthProfile.nhom_tuoi)}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('profile')}
                  className="px-2 py-1 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 font-bold text-[11px] rounded-lg shrink-0 cursor-pointer shadow-2xs"
                >
                  Sửa
                </button>
              </div>

              {/* REQUIREMENT 2: Editable Live Transcript Area */}
              <div className="w-full max-w-sm mb-2 p-3 bg-surface-container rounded-xl border border-outline-variant shadow-xs space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">record_voice_over</span> Câu nói người dùng (Sửa được):
                  </span>
                  <button
                    onClick={() => setIsEditingTranscript(!isEditingTranscript)}
                    className="text-xs text-primary font-bold hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-sm">{isEditingTranscript ? 'check' : 'edit'}</span>
                    {isEditingTranscript ? 'Hoàn tất' : 'Chỉnh sửa'}
                  </button>
                </div>

                {isEditingTranscript ? (
                  <textarea
                    rows={2}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    className="w-full text-sm font-bold text-on-surface p-2 bg-white border border-primary rounded-lg focus:outline-none"
                    placeholder="Nhập hoặc chỉnh sửa triệu chứng..."
                  />
                ) : (
                  <p className="font-semibold text-sm sm:text-base text-on-surface leading-snug bg-white/80 p-2 rounded-lg border border-gray-100">
                    "{transcript || 'Chưa nhận diện câu nói...'}"
                  </p>
                )}

                {/* Confirm & Send Button */}
                <button
                  onClick={handleConfirmAndSendTranscript}
                  className="w-full py-1.5 px-3 bg-[#00685c] text-white text-xs font-bold rounded-lg hover:bg-[#005047] transition-all flex items-center justify-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">send</span>
                  Xác nhận & Gửi tới Dược sĩ AI
                </button>

                {/* Control Action Buttons: Stop Speaking & Clear Conversation */}
                <div className="flex items-center gap-2 pt-1 border-t border-gray-200/80">
                  <button
                    type="button"
                    onClick={handleStopAiSpeaking}
                    className="flex-1 py-1 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95 shadow-2xs"
                    title="Dừng âm thanh AI đang đọc"
                  >
                    <span className="material-symbols-outlined text-sm">volume_off</span>
                    Dừng AI nói
                  </button>

                  <button
                    type="button"
                    onClick={handleClearConversation}
                    className="flex-1 py-1 px-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer active:scale-95 shadow-2xs"
                    title="Xóa nội dung cuộc hội thoại hiện tại"
                  >
                    <span className="material-symbols-outlined text-sm">delete_sweep</span>
                    Xóa hội thoại
                  </button>
                </div>
              </div>

              {/* AI Realtime Speech Response Box */}
              {aiResponseText && (
                <div className="w-full max-w-sm mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 font-medium leading-relaxed flex items-start gap-2 shadow-xs">
                  <span className="material-symbols-outlined text-emerald-700 text-lg shrink-0 mt-0.5">smart_toy</span>
                  <div>
                    <span className="font-bold block text-[#00685c]">Dược sĩ AI (Đang nói):</span>
                    <p>{aiResponseText}</p>
                  </div>
                </div>
              )}



              {/* REQUIREMENT 1: 3D Mic & Hold-to-Talk / Tap-to-Talk */}
              <div
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onClick={handleTapToggle}
                className="relative w-[180px] h-[180px] sm:w-[200px] sm:h-[200px] flex items-center justify-center my-1 cursor-pointer select-none touch-none"
              >
                <ThreeMicSphere isListening={isListening} />
              </div>

              {/* Status Line */}
              <div className="flex items-center gap-2">
                <button
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  onClick={handleTapToggle}
                  className={`flex items-center gap-2 text-primary font-label-lg text-sm font-semibold cursor-pointer py-1.5 px-4 rounded-full transition-all shadow-xs touch-none select-none ${
                    isListening ? 'animate-pulse bg-red-500 text-white font-bold' : 'bg-surface-container text-on-surface-variant hover:bg-gray-200'
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-lg"
                    style={{ fontVariationSettings: isListening ? "'FILL' 1" : "'FILL' 0" }}
                  >
                    {isListening ? 'mic' : 'mic_none'}
                  </span>
                  <span>{isListening ? 'Đang thu âm... (Buông ra để ngưng)' : 'Giữ hoặc bấm nút để nói'}</span>
                </button>
              </div>
            </section>

            {/* Bottom Half: Live Shopping Cart */}
            <section className="flex-1 overflow-y-auto bg-surface p-4 space-y-4 pb-[180px]">
              <div className="w-full max-w-sm mx-auto space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <h2 className="font-headline-md text-lg font-bold text-on-surface">Gợi ý cho bạn</h2>
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" /> Live Sync
                    </span>
                  </div>
                  {cartItems.length > 0 && (
                    <button
                      onClick={clearAllCartItems}
                      className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1 rounded-lg border border-red-200 font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-sm">delete_sweep</span>
                      Xóa tất cả
                    </button>
                  )}
                </div>

                {/* Empty Cart State */}
                {cartItems.length === 0 && (
                  <div className="bg-surface-container-lowest rounded-xl p-6 text-center border border-dashed border-outline-variant my-2">
                    <span className="material-symbols-outlined text-4xl text-emerald-700 mb-2">shopping_bag</span>
                    <p className="font-bold text-sm text-gray-800">Giỏ hàng đang trống</p>
                    <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto leading-relaxed">
                      Hãy ấn giữ micro và nói triệu chứng (ví dụ: "Tôi bị ho ngứa cổ" hoặc "Tôi bị cảm sốt") để Dược sĩ AI tự động tư vấn & thêm thuốc vào giỏ!
                    </p>
                  </div>
                )}

                {/* Warning Banners - Only shown when user has added an incompatible or warned product */}
                {cartItems
                  .filter((item) => item.isDisabled || item.isWarning || item.disabledReason)
                  .map((item) => (
                    <div
                      key={`warning-${item.id}`}
                      className="bg-error-container rounded-xl p-3.5 flex items-start gap-3 border border-[#ffb4ab] shadow-xs"
                    >
                      <span
                        className="material-symbols-outlined text-error shrink-0 mt-0.5 text-xl"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        error
                      </span>
                      <div className="text-xs sm:text-sm text-on-error-container font-medium leading-relaxed">
                        <p className="font-bold text-error">Cảnh báo không tương thích: {item.name}</p>
                        <p>{item.disabledReason || item.warningMessage || 'Sản phẩm này không phù hợp với tiền sử bệnh hoặc dị ứng của bạn.'}</p>
                      </div>
                    </div>
                  ))}

                {/* Product Cards List */}
                {cartItems.map((item) => {
                  if (item.isDisabled) {
                    return (
                      <div
                        key={item.id}
                        className="bg-surface-container-lowest rounded-xl p-3.5 soft-shadow border border-error-container flex gap-3 relative opacity-75"
                      >
                        <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-surface-container flex items-center justify-center p-1">
                          {item.imageUrl ? (
                            <img
                              alt={item.name}
                              className="w-full h-full object-cover grayscale"
                              src={item.imageUrl}
                            />
                          ) : (
                            <span className="material-symbols-outlined text-3xl text-outline">
                              medication
                            </span>
                          )}
                        </div>
                        <div className="flex-1 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between">
                              <h3 className="font-label-lg text-sm font-bold text-on-surface line-through decoration-error flex items-center gap-1">
                                {item.name}{' '}
                                <span className="material-symbols-outlined text-[14px] text-outline">info</span>
                              </h3>
                              <button
                                onClick={() => removeItem(item.id)}
                                className="text-gray-400 hover:text-red-600 p-1 rounded-full transition-colors cursor-pointer"
                                title="Xóa khỏi giỏ"
                              >
                                <span className="material-symbols-outlined text-base">delete</span>
                              </button>
                            </div>
                            <div className="mt-0.5">
                              <span className="inline-block bg-surface-container-high text-on-surface-variant text-[11px] px-2 py-0.5 rounded-full font-medium">
                                {item.activeIngredient || 'Thành phần cần lưu ý'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-end justify-between mt-2">
                            <span className="font-label-lg text-xs font-semibold text-on-surface-variant">
                              {item.price.toLocaleString('vi-VN')}đ
                            </span>
                            {/* Disabled Quantity Stepper */}
                            <div className="flex items-center bg-surface-dim rounded-full h-8 px-1 opacity-50 cursor-not-allowed">
                              <button className="w-6 h-6 flex items-center justify-center text-outline" disabled>
                                <span className="material-symbols-outlined text-sm">remove</span>
                              </button>
                              <span className="w-6 text-center font-bold text-xs text-outline">0</span>
                              <button className="w-6 h-6 flex items-center justify-center text-outline" disabled>
                                <span className="material-symbols-outlined text-sm">add</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className="bg-surface-container-lowest rounded-xl p-3.5 soft-shadow border border-surface-variant flex gap-3 relative transition-all"
                    >
                      <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-surface-container flex items-center justify-center p-1">
                        {item.imageUrl ? (
                          <img
                            alt={item.name}
                            className="w-full h-full object-cover"
                            src={item.imageUrl}
                          />
                        ) : (
                          <span className="material-symbols-outlined text-3xl text-primary">
                            {item.name.toLowerCase().includes('chai') ? 'local_drink' : 'pill'}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between">
                            <h3 className="font-label-lg text-sm font-bold text-on-surface flex items-center gap-1">
                              {item.name}{' '}
                              <span className="material-symbols-outlined text-[14px] text-outline">info</span>
                            </h3>
                            <button
                              onClick={() => removeItem(item.id)}
                              className="text-gray-400 hover:text-red-600 p-1 rounded-full transition-colors cursor-pointer"
                              title="Xóa khỏi giỏ"
                            >
                              <span className="material-symbols-outlined text-base">delete</span>
                            </button>
                          </div>
                          <div className="mt-0.5">
                            <span className="inline-block bg-surface-container-high text-on-surface-variant text-[11px] px-2 py-0.5 rounded-full font-medium">
                              {item.activeIngredient || 'Dược chất chính'}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">
                            {item.source}
                          </p>
                        </div>
                        <div className="flex items-end justify-between mt-2">
                          <span className="font-label-lg text-sm font-bold text-primary">
                            {(item.price * item.quantity).toLocaleString('vi-VN')}đ
                          </span>
                          {/* Quantity Stepper */}
                          <div className="flex items-center bg-surface-container rounded-full h-9 px-1 border border-outline-variant">
                            <button
                              aria-label="Giảm số lượng"
                              onClick={() => updateQuantity(item.id, -1)}
                              className="w-7 h-7 flex items-center justify-center text-primary rounded-full hover:bg-surface-variant transition-colors cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-base">remove</span>
                            </button>
                            <span className="w-7 text-center font-bold text-sm text-on-surface">
                              {item.quantity}
                            </span>
                            <button
                              aria-label="Tăng số lượng"
                              onClick={() => updateQuantity(item.id, 1)}
                              className="w-7 h-7 flex items-center justify-center text-primary rounded-full hover:bg-surface-variant transition-colors cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-base">add</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {/* Products Tab */}
        {activeTab === 'products' && (
          <div className="flex-1 flex flex-col p-4 bg-[#ebefec] overflow-y-auto space-y-4">
            <div className="bg-white p-3.5 rounded-xl border border-[#bdc9c5] shadow-xs">
              <h2 className="text-sm font-bold text-[#00685c] mb-1 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base">medication</span>
                Danh mục Thuốc & Thực phẩm Chức năng
              </h2>
              <p className="text-[11px] text-slate-500">
                Tìm kiếm và chọn mua các loại thuốc được đồng bộ từ Google Sheets.
              </p>
              
              <div className="mt-3 relative">
                <input
                  type="text"
                  placeholder="Tìm tên thuốc, hoạt chất..."
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-xs focus:ring-1 focus:ring-primary focus:outline-none"
                />
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-base">
                  search
                </span>
              </div>
            </div>

            {/* List of Products */}
            <div className="space-y-3 overflow-y-auto flex-1 pb-2">
              {filteredProducts.length === 0 ? (
                <div className="bg-white p-6 rounded-xl border border-[#bdc9c5] text-center text-xs text-slate-500">
                  Không tìm thấy thuốc nào khớp với từ khóa tìm kiếm.
                </div>
              ) : (
                paginatedProducts.map((prod: any) => {
                  const cartItem = cartItems.find((item) => item.id === prod.sku);
                  const qty = cartItem ? cartItem.quantity : 0;
                  
                  return (
                    <div key={prod.sku} className="bg-white p-3 rounded-xl border border-[#bdc9c5] shadow-xs flex gap-3 items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-bold text-xs text-[#181c1b] truncate">{prod.ten_san_pham}</h3>
                          <span className="bg-emerald-50 text-emerald-800 text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0">
                            {prod.dang_bao_che || 'Đơn vị'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">Hoạt chất: {prod.hoat_chat} {prod.ham_luong_mg}</p>
                        {prod.chi_dinh_ngan && (
                          <p className="text-[10px] text-slate-600 mt-1 line-clamp-2"><span className="font-semibold">Chỉ định:</span> {prod.chi_dinh_ngan}</p>
                        )}
                        <p className="text-xs font-bold text-[#00685c] mt-1.5">{(prod.gia || 0).toLocaleString('vi-VN')}đ</p>
                      </div>

                      <div className="shrink-0 flex flex-col items-end justify-between h-full min-h-[60px]">
                        {qty > 0 ? (
                          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-lg p-0.5 shadow-2xs">
                            <button
                              onClick={() => updateQuantity(prod.sku, -1)}
                              className="w-6 h-6 bg-white hover:bg-emerald-100 text-emerald-800 font-bold rounded-md flex items-center justify-center transition-colors shadow-2xs cursor-pointer text-xs"
                            >
                              -
                            </button>
                            <span className="text-xs font-bold text-emerald-900 w-4 text-center">{qty}</span>
                            <button
                              onClick={() => updateQuantity(prod.sku, 1)}
                              className="w-6 h-6 bg-white hover:bg-emerald-100 text-emerald-800 font-bold rounded-md flex items-center justify-center transition-colors shadow-2xs cursor-pointer text-xs"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleAddProductToCart(prod)}
                            className="px-2.5 py-1 bg-[#00685c] hover:bg-[#005047] text-white text-[10px] font-bold rounded-lg flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                          >
                            <span className="material-symbols-outlined text-[10px] font-bold">add</span>
                            Thêm
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination Controls */}
            {filteredProducts.length > 0 && (
              <div className="bg-white p-2.5 rounded-xl border border-[#bdc9c5] shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
                <span className="text-slate-500 text-[11px] font-medium">
                  Trang <span className="font-bold text-[#00685c]">{currentProductPage}</span> / {totalProductPages} ({filteredProducts.length} thuốc)
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentProductPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentProductPage === 1}
                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md font-semibold text-[11px] transition-colors flex items-center gap-0.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-xs">chevron_left</span>
                    Trước
                  </button>

                  {Array.from({ length: totalProductPages }, (_, i) => i + 1)
                    .filter((page) => {
                      return (
                        page === 1 ||
                        page === totalProductPages ||
                        Math.abs(page - currentProductPage) <= 1
                      );
                    })
                    .map((page, index, array) => {
                      const showEllipsis = index > 0 && page - array[index - 1] > 1;
                      return (
                        <React.Fragment key={page}>
                          {showEllipsis && <span className="text-slate-400 text-[10px] px-0.5">...</span>}
                          <button
                            onClick={() => setCurrentProductPage(page)}
                            className={`w-6 h-6 rounded-md font-bold text-[11px] flex items-center justify-center transition-colors cursor-pointer ${
                              currentProductPage === page
                                ? 'bg-[#00685c] text-white shadow-2xs'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {page}
                          </button>
                        </React.Fragment>
                      );
                    })}

                  <button
                    onClick={() => setCurrentProductPage((prev) => Math.min(prev + 1, totalProductPages))}
                    disabled={currentProductPage === totalProductPages}
                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md font-semibold text-[11px] transition-colors flex items-center gap-0.5 cursor-pointer"
                  >
                    Sau
                    <span className="material-symbols-outlined text-xs">chevron_right</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Prescriptions Tab */}
        {activeTab === 'prescriptions' && (
          <div className="p-4 max-w-sm mx-auto space-y-4 pb-16 animate-fade-in">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-[#00685c]">Đơn thuốc & Lịch sử</h2>
              <button
                onClick={fetchMyOrders}
                disabled={isLoadingOrders}
                className="text-xs font-semibold text-[#00685c] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span className={`material-symbols-outlined text-xs ${isLoadingOrders ? 'animate-spin' : ''}`}>refresh</span>
                Làm mới
              </button>
            </div>

            {/* Status Tabs/Pills */}
            <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none border-b border-gray-100 -mx-1 px-1">
              {[
                { id: 'all', label: 'Tất cả' },
                { id: 'cho_duyet', label: 'Chờ duyệt' },
                { id: 'duoc_duyet', label: 'Đã duyệt' },
                { id: 'da_huy', label: 'Đã hủy' },
                { id: 'da_thanh_toan', label: 'Đã thanh toán' },
              ].map((tab) => {
                const count = myOrders.filter((order) => {
                  const isPending = order.status === 'cho_duyet' || order.status === 'pending';
                  const isApproved = order.status === 'duoc_duyet' || order.status === 'approved';
                  const isPaid = order.status === 'da_thanh_toan';
                  const isCancelled = order.status === 'da_huy' || order.status === 'rejected';

                  if (tab.id === 'all') return true;
                  if (tab.id === 'cho_duyet') return isPending;
                  if (tab.id === 'duoc_duyet') return isApproved;
                  if (tab.id === 'da_huy') return isCancelled;
                  if (tab.id === 'da_thanh_toan') return isPaid;
                  return false;
                }).length;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setPrescFilter(tab.id as any)}
                    className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold shrink-0 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                      prescFilter === tab.id
                        ? 'bg-[#00685c] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`text-[9px] px-1 py-0.2 rounded-full ${prescFilter === tab.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {isLoadingOrders && myOrders.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                Đang tải đơn thuốc...
              </div>
            ) : myOrders.length === 0 ? (
              <div className="bg-white rounded-xl p-6 text-center border border-dashed border-[#bdc9c5]">
                <span className="material-symbols-outlined text-3xl text-[#00685c]/60 mb-2">description</span>
                <p className="font-bold text-xs text-gray-800">Chưa có đơn thuốc nào</p>
                <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                  Đơn thuốc của bạn sau khi gửi yêu cầu duyệt sẽ hiển thị tại đây để bạn theo dõi và thanh toán.
                </p>
              </div>
            ) : (() => {
              const filteredOrders = myOrders.filter((order) => {
                const isPending = order.status === 'cho_duyet' || order.status === 'pending';
                const isApproved = order.status === 'duoc_duyet' || order.status === 'approved';
                const isPaid = order.status === 'da_thanh_toan';
                const isCancelled = order.status === 'da_huy' || order.status === 'rejected';

                if (prescFilter === 'all') return true;
                if (prescFilter === 'cho_duyet') return isPending;
                if (prescFilter === 'duoc_duyet') return isApproved;
                if (prescFilter === 'da_huy') return isCancelled;
                if (prescFilter === 'da_thanh_toan') return isPaid;
                return true;
              });

              if (filteredOrders.length === 0) {
                return (
                  <div className="bg-white rounded-xl p-6 text-center border border-dashed border-[#bdc9c5] py-10">
                    <span className="material-symbols-outlined text-3xl text-gray-300 mb-2">search_off</span>
                    <p className="font-bold text-xs text-gray-700">Không tìm thấy đơn hàng</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Không có đơn hàng nào ở trạng thái này.</p>
                  </div>
                );
              }

              return (
                <div className="space-y-3.5">
                  {filteredOrders.map((order) => {
                    const items = order.items || [];
                    const isPending = order.status === 'cho_duyet' || order.status === 'pending';
                    const isApproved = order.status === 'duoc_duyet' || order.status === 'approved';
                    const isPaid = order.status === 'da_thanh_toan';
                    const isCancelled = order.status === 'da_huy' || order.status === 'rejected';

                    return (
                      <div key={order.id} className="bg-white border border-[#bdc9c5] rounded-xl p-4 shadow-xs space-y-3 transition-all hover:shadow-md">
                        <div className="flex justify-between items-center border-b pb-2 border-slate-100">
                          <span className="font-bold text-xs text-gray-400">#{order.id.substring(0, 8)}</span>
                          {isPending && (
                            <span className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-bold uppercase">
                              Chờ duyệt
                            </span>
                          )}
                          {isApproved && (
                            <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded font-bold uppercase animate-pulse">
                              Được duyệt
                            </span>
                          )}
                          {isPaid && (
                            <span className="text-[10px] bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded font-bold uppercase">
                              Đã thanh toán
                            </span>
                          )}
                          {isCancelled && (
                            <span className="text-[10px] bg-red-50 text-red-800 border border-red-200 px-2 py-0.5 rounded font-bold uppercase">
                              Đã hủy
                            </span>
                          )}
                        </div>

                        <div className="space-y-1 text-xs text-gray-600">
                          <p><span className="font-medium text-gray-800">Người nhận:</span> {order.patientName || 'Chưa cập nhật'}</p>
                          {order.patientPhone && <p><span className="font-medium text-gray-800">Số điện thoại:</span> {order.patientPhone}</p>}
                          {order.patientAddress && <p><span className="font-medium text-gray-800">Giao tới:</span> {order.patientAddress}</p>}
                          {order.voiceTranscript && (
                            <p className="italic bg-gray-50 p-1.5 rounded border border-gray-100 text-[11px] mt-1 text-gray-500">
                              " {order.voiceTranscript} "
                            </p>
                          )}
                        </div>

                        <div className="bg-[#fcfdfd] border border-slate-100 p-2.5 rounded text-xs space-y-1">
                          <p className="font-bold text-[11px] text-[#00685c] mb-1">Danh mục thuốc:</p>
                          {items.map((it: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-gray-700 text-[11px]">
                              <span>• {it.name} (x{it.quantity} {it.unit || 'phần'})</span>
                              <span>{((it.price || 0) * (it.quantity || 1)).toLocaleString('vi-VN')}đ</span>
                            </div>
                          ))}
                          <div className="border-t border-slate-100 pt-1.5 mt-1.5 font-bold text-xs flex justify-between text-[#00685c]">
                            <span>Tổng giá:</span>
                            <span>{(order.totalPrice || items.reduce((sum: number, it: any) => sum + (it.price || 0) * (it.quantity || 1), 0)).toLocaleString('vi-VN')}đ</span>
                          </div>
                        </div>

                        {/* Pay Button if Approved */}
                        {isApproved && (
                          <button
                            onClick={async () => {
                              try {
                                const token = await user.getIdToken();
                                const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/pay`, {
                                  method: 'POST',
                                  headers: {
                                    authorization: `Bearer ${token}`
                                  }
                                });
                                const result = await res.json();
                                if (result.success) {
                                  setNotification('💰 Đã thanh toán đơn thuốc thành công! Nhà thuốc đang giao hàng cho bạn.');
                                  fetchMyOrders();
                                } else {
                                  setNotification('⚠️ Thanh toán không thành công. Vui lòng thử lại.');
                                }
                                setTimeout(() => setNotification(null), 3000);
                              } catch (error) {
                                console.error('Error paying order:', error);
                              }
                            }}
                            className="w-full bg-[#00685c] hover:bg-[#005047] text-white py-2 rounded-lg font-bold text-xs transition-all shadow-xs hover:shadow-md cursor-pointer flex items-center justify-center gap-1.5 active:scale-[0.98]"
                          >
                            <span className="material-symbols-outlined text-sm">payments</span>
                            Thanh toán đơn thuốc này
                          </button>
                        )}

                        {/* Status Warnings or Information */}
                        {isPending && (
                          <div className="p-2 bg-amber-50 rounded-lg text-[10px] text-amber-800 font-medium flex gap-1 items-start">
                            <span className="material-symbols-outlined text-xs shrink-0 mt-0.5 animate-bounce">pending</span>
                            <span>Vui lòng đợi Bác sĩ/Dược sĩ lâm sàng xem xét đơn thuốc. Bạn sẽ có thể thanh toán sau khi đơn được phê duyệt.</span>
                          </div>
                        )}

                        {isPaid && (
                          <div className="p-2 bg-emerald-50 rounded-lg text-[10px] text-emerald-800 font-medium flex gap-1 items-start">
                            <span className="material-symbols-outlined text-xs shrink-0 mt-0.5">local_shipping</span>
                            <span>Đơn hàng đã thanh toán. Đang trên đường vận chuyển tới địa chỉ của bạn!</span>
                          </div>
                        )}

                        {isCancelled && (
                          <div className="p-2 bg-red-50 rounded-lg text-[10px] text-red-800 font-medium flex gap-1 items-start">
                            <span className="material-symbols-outlined text-xs shrink-0 mt-0.5">cancel</span>
                            <span>Đơn thuốc bị từ chối hoặc hủy bỏ do không đảm bảo an toàn lâm sàng. Bạn không thể thanh toán cho đơn hàng này.</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* Profile / Auth & Health Profile Tab */}
        {activeTab === 'profile' && (
          <div className="p-4 max-w-sm mx-auto space-y-4 pb-8">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-[#00685c]">Hồ sơ sức khỏe bệnh nhân</h2>
              <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> AI Live Sync
              </span>
            </div>

            {renderDomainErrorHelp()}

            {/* Account Card */}
            <div className="bg-white border rounded-xl p-3.5 shadow-xs flex items-center justify-between">
              {user && !user.isAnonymous ? (
                <div className="flex items-center gap-3">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName || 'User'} className="w-10 h-10 rounded-full border" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-[#00685c] text-white flex items-center justify-center font-bold text-base">
                      {user.displayName?.charAt(0) || 'U'}
                    </div>
                  )}
                  <div>
                    <p className="font-bold text-xs text-gray-900">{user.displayName || 'Bệnh nhân'}</p>
                    <p className="text-[11px] text-gray-500">{user.email}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 text-[#00685c] flex items-center justify-center font-bold">
                    <span className="material-symbols-outlined text-sm">person</span>
                  </div>
                  <div>
                    <p className="font-bold text-xs text-gray-800">Tài khoản khách (Mặc định)</p>
                    <p className="text-[10px] text-gray-500">Đăng nhập để lưu vĩnh viễn trên Cloud</p>
                  </div>
                </div>
              )}

              {user && !user.isAnonymous ? (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await logoutUser();
                      setNotification('👋 Đã đăng xuất khỏi tài khoản Google.');
                      setTimeout(() => setNotification(null), 3000);
                    } catch (err: any) {
                      console.error('Logout error:', err);
                      setNotification(`Lỗi đăng xuất: ${err.message || err}`);
                      setTimeout(() => setNotification(null), 5000);
                    }
                  }}
                  className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Đăng xuất
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      setShowPopupBlockedHelp(false);
                      await signInWithGoogle();
                      setNotification('👋 Đăng nhập thành công với Google!');
                      setTimeout(() => setNotification(null), 3000);
                    } catch (err: any) {
                      console.error('Auth click error:', err);
                      const isDomainError = err.message?.includes('unauthorized-domain') || String(err).includes('unauthorized-domain');
                      if (isDomainError) {
                        setShowDomainErrorHelp(true);
                      }
                      const isPopupBlocked = err.code === 'auth/popup-blocked' || err.message?.includes('popup-blocked') || String(err).includes('popup-blocked');
                      if (isPopupBlocked) {
                        setShowPopupBlockedHelp(true);
                        setNotification('⚠️ Trình duyệt chặn Popup. Vui lòng xem hướng dẫn bên dưới.');
                      } else {
                        setNotification(`Lỗi đăng nhập: ${err.message || err}`);
                      }
                      setTimeout(() => setNotification(null), 5000);
                    }
                  }}
                  className="px-2.5 py-1 bg-[#00685c] hover:bg-[#005047] text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  Đăng nhập
                </button>
              )}
            </div>

            {/* Health Profile Edit Form */}
            <form onSubmit={handleSaveHealthProfile} className="bg-white border border-[#bdc9c5] rounded-xl p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-bold text-sm text-[#00685c] flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">medical_information</span>
                  Tiền sử lâm sàng & Dị ứng
                </h3>
                <span className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                  {user ? 'Firestore Cloud' : 'Bộ nhớ địa phương'}
                </span>
              </div>

              {/* Notice Banner */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 text-[11px] text-emerald-900 leading-relaxed flex items-start gap-2">
                <span className="material-symbols-outlined text-emerald-700 text-base shrink-0 mt-0.5">info</span>
                <p>
                  <strong>Dược sĩ AI Live</strong> sẽ liên tục tham chiếu các thông tin dưới đây trong lúc tư vấn và hỏi đáp để đưa ra khuyến cáo an toàn. AI cũng có thể tự cập nhật khi phát hiện thông tin mới trong lời nói của bạn!
                </p>
              </div>

              {/* Field 0: Họ và tên bệnh nhân (có dấu) */}
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
                  <span>Họ và tên bệnh nhân (có dấu):</span>
                  <span className="text-[10px] font-semibold text-[#00685c]">(Mặc định từ Gmail / Google Account)</span>
                </label>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nhập họ và tên bệnh nhân có dấu (ví dụ: Trần Văn Nam, Nguyễn Thị Mai)..."
                  className="w-full text-xs p-2 bg-emerald-50/60 border border-emerald-300 rounded-lg focus:bg-white focus:border-[#00685c] focus:outline-none font-bold text-[#00685c]"
                />
              </div>

              {/* Field 1: Bệnh nền / Tiền sử lâm sàng */}
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
                  <span>1. Tiền sử lâm sàng / Bệnh nền:</span>
                  <span className="text-[10px] font-normal text-gray-500">(Ví dụ: Cao huyết áp, Tiểu đường)</span>
                </label>
                <input
                  type="text"
                  value={formatConditionToVietnamese(healthProfile.benh_nen) || ''}
                  onChange={(e) => setHealthProfile({ ...healthProfile, benh_nen: e.target.value })}
                  placeholder="Nhập bệnh nền (ví dụ: Cao huyết áp, Tiểu đường, Dạ dày...)"
                  className="w-full text-xs p-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:border-[#00685c] focus:outline-none font-semibold text-gray-900"
                />
                {/* Quick Tags */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('benh_nen', 'Cao huyết áp')}
                    className="text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200 font-medium cursor-pointer"
                  >
                    + Cao huyết áp
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('benh_nen', 'Tiểu đường')}
                    className="text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200 font-medium cursor-pointer"
                  >
                    + Tiểu đường
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('benh_nen', 'Loét dạ dày-tá tràng')}
                    className="text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-200 font-medium cursor-pointer"
                  >
                    + Loét dạ dày-tá tràng
                  </button>
                </div>
              </div>

              {/* Field 2: Dị ứng ghi nhận */}
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
                  <span>2. Dị ứng ghi nhận:</span>
                  <span className="text-[10px] font-normal text-red-600">(Rất quan trọng!)</span>
                </label>
                <input
                  type="text"
                  value={formatConditionToVietnamese(healthProfile.di_ung) || ''}
                  onChange={(e) => setHealthProfile({ ...healthProfile, di_ung: e.target.value })}
                  placeholder="Nhập dị ứng (ví dụ: Penicillin, Aspirin, Paracetamol...)"
                  className="w-full text-xs p-2 bg-red-50/50 border border-red-200 rounded-lg focus:bg-white focus:border-red-500 focus:outline-none font-semibold text-red-900"
                />
                {/* Quick Allergy Tags */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('di_ung', 'Penicillin')}
                    className="text-[10px] bg-red-50 hover:bg-red-100 text-red-800 px-2 py-0.5 rounded-full border border-red-200 font-medium cursor-pointer"
                  >
                    + Dị ứng Penicillin
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('di_ung', 'Aspirin')}
                    className="text-[10px] bg-red-50 hover:bg-red-100 text-red-800 px-2 py-0.5 rounded-full border border-red-200 font-medium cursor-pointer"
                  >
                    + Dị ứng Aspirin
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('di_ung', 'Paracetamol')}
                    className="text-[10px] bg-red-50 hover:bg-red-100 text-red-800 px-2 py-0.5 rounded-full border border-red-200 font-medium cursor-pointer"
                  >
                    + Dị ứng Paracetamol
                  </button>
                </div>
              </div>

              {/* Field 3: Độ tuổi & Nhóm đối tượng */}
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
                  <span>3. Độ tuổi / Nhóm đối tượng:</span>
                  <span className="text-[10px] font-normal text-gray-500">(Cần cho tính liều an toàn Max_Dose)</span>
                </label>
                <input
                  type="text"
                  value={healthProfile.do_tuoi || (healthProfile.nhom_tuoi ? formatAgeDisplay(undefined, healthProfile.nhom_tuoi) : '')}
                  onChange={(e) => setHealthProfile({ ...healthProfile, do_tuoi: e.target.value, nhom_tuoi: e.target.value })}
                  placeholder="Nhập tuổi hoặc nhóm (ví dụ: 16 tuổi, 40 tuổi, Trẻ em, Người cao tuổi...)"
                  className="w-full text-xs p-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:border-[#00685c] focus:outline-none font-semibold text-gray-900"
                />
                {/* Quick Age Tags */}
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('do_tuoi', '16 tuổi')}
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-medium cursor-pointer"
                  >
                    + 16 tuổi
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('do_tuoi', '40 tuổi')}
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-medium cursor-pointer"
                  >
                    + Người lớn (40t)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('do_tuoi', '68 tuổi')}
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-medium cursor-pointer"
                  >
                    + Người cao tuổi (68t)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('do_tuoi', '8 tuổi')}
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-medium cursor-pointer"
                  >
                    + Trẻ em (8t)
                  </button>
                </div>
              </div>

              {/* Field 4: Thuốc đang sử dụng */}
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
                  <span>4. Thuốc đang sử dụng (nếu có):</span>
                  <span className="text-[10px] font-normal text-blue-600">(Để kiểm tra tương tác)</span>
                </label>
                <input
                  type="text"
                  value={Array.isArray(healthProfile.thuoc_dang_dung) ? healthProfile.thuoc_dang_dung.join(', ') : (healthProfile.thuoc_dang_dung || '')}
                  onChange={(e) => setHealthProfile({ ...healthProfile, thuoc_dang_dung: e.target.value })}
                  placeholder="Nhập tên thuốc đang uống (ví dụ: Amlodipine, Metformin, Panadol...)"
                  className="w-full text-xs p-2 bg-blue-50/50 border border-blue-200 rounded-lg focus:bg-white focus:border-blue-500 focus:outline-none font-semibold text-blue-900"
                />
                <div className="flex flex-wrap gap-1 mt-1.5">
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('thuoc_dang_dung', 'Amlodipine')}
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-medium cursor-pointer"
                  >
                    + Amlodipine
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddQuickTag('thuoc_dang_dung', 'Metformin')}
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full border border-blue-200 font-medium cursor-pointer"
                  >
                    + Metformin
                  </button>
                </div>
              </div>

              {/* Field 5: Ghi chú sức khỏe bổ sung */}
              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1">
                  5. Ghi chú sức khỏe khác:
                </label>
                <textarea
                  rows={2}
                  value={healthProfile.ghi_chu_suckhoe || ''}
                  onChange={(e) => setHealthProfile({ ...healthProfile, ghi_chu_suckhoe: e.target.value })}
                  placeholder="Mô tả thêm về diễn tiến bệnh hoặc đơn thuốc đang dùng..."
                  className="w-full text-xs p-2 bg-gray-50 border border-gray-300 rounded-lg focus:bg-white focus:border-[#00685c] focus:outline-none text-gray-800"
                />
              </div>

              {profileErrorMsg && (
                <div className="p-2 bg-red-100 text-red-800 text-xs font-bold rounded-lg text-center animate-fade-in">
                  ❌ {profileErrorMsg}
                </div>
              )}

              {profileSavedMsg && (
                <div className="p-2 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-lg text-center animate-fade-in">
                  ✓ Đã lưu thành công hồ sơ sức khỏe & đồng bộ Firestore!
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingProfile}
                className="w-full py-2.5 bg-[#00685c] hover:bg-[#005047] text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">save</span>
                {isSavingProfile ? 'Đang lưu...' : 'Lưu hồ sơ sức khỏe'}
              </button>
            </form>
          </div>
        )}
      </main>

      {/* Bottom Cart Bar - ONLY SHOWN ON HOME TAB */}
        {activeTab === 'home' && (
          <div className="bg-white border-t border-[#bdc9c5] p-3 shadow-md z-20 shrink-0 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold uppercase tracking-wider text-[#3e4946]">Tổng cộng:</span>
              <span className="text-lg font-bold text-[#00685c]">
                {calculateTotal().toLocaleString('vi-VN')}đ
              </span>
            </div>
            <button
              onClick={() => setShowCheckoutModal(true)}
              className="bg-[#00685c] w-full text-white text-sm font-bold h-10 rounded-md flex items-center justify-center hover:bg-[#005047] transition-all cursor-pointer shadow-xs gap-1"
            >
              <span className="material-symbols-outlined text-base">rate_review</span>
              Yêu cầu duyệt đơn thuốc
            </button>
          </div>
        )}

        {/* BottomNavBar */}
        <nav className="bg-[#ebefec] text-[#00685c] border-t border-[#bdc9c5] shrink-0 z-30 flex justify-around items-center px-1 h-14">
          <button
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center justify-center px-3 py-1 rounded-md transition-all cursor-pointer ${
              activeTab === 'home'
                ? 'bg-[#218274] text-white font-bold'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span
              className="material-symbols-outlined text-lg"
              style={{ fontVariationSettings: activeTab === 'home' ? "'FILL' 1" : "'FILL' 0" }}
            >
              home
            </span>
            <span className="text-[10px] mt-0.5">Trang chủ</span>
          </button>

          <button
            onClick={() => setActiveTab('products')}
            className={`flex flex-col items-center justify-center px-3 py-1 rounded-md transition-colors cursor-pointer ${
              activeTab === 'products'
                ? 'bg-[#218274] text-white font-bold'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span
              className="material-symbols-outlined text-lg"
              style={{ fontVariationSettings: activeTab === 'products' ? "'FILL' 1" : "'FILL' 0" }}
            >
              medication
            </span>
            <span className="text-[10px] mt-0.5">Danh mục</span>
          </button>

          <button
            onClick={() => setActiveTab('prescriptions')}
            className={`flex flex-col items-center justify-center px-3 py-1 rounded-md transition-colors cursor-pointer ${
              activeTab === 'prescriptions'
                ? 'bg-[#218274] text-white font-bold'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span className="material-symbols-outlined text-lg">description</span>
            <span className="text-[10px] mt-0.5">Đơn thuốc</span>
          </button>

          <button
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center justify-center px-3 py-1 rounded-md transition-colors cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-[#218274] text-white font-bold'
                : 'text-[#3e4946] hover:bg-[#dfe3e1]'
            }`}
          >
            <span className="material-symbols-outlined text-lg">person</span>
            <span className="text-[10px] mt-0.5">Cá nhân</span>
          </button>
        </nav>

      {/* Checkout Modal */}
      {showCheckoutModal && (
        <div className="absolute inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-3 overflow-y-auto">
          <div className="bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl max-w-md w-full p-6 shadow-2xl border border-outline-variant max-h-[90vh] overflow-y-auto">
            {checkoutSuccess ? (
              <div className="text-center py-8 space-y-3 animate-fade-in">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-3xl animate-bounce">
                  <span className="material-symbols-outlined">rate_review</span>
                </div>
                <h3 className="font-bold text-xl text-primary">Gửi yêu cầu thành công!</h3>
                <p className="text-sm text-on-surface-variant">
                  Yêu cầu duyệt đơn thuốc đã được chuyển tới <span className="font-bold text-on-surface">Bác sĩ & Dược sĩ trực</span> để kiểm tra lâm sàng. Bạn có thể tiến hành thanh toán ngay sau khi đơn được phê duyệt!
                </p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center border-b pb-3 mb-4">
                  <h3 className="font-bold text-lg text-primary flex items-center gap-2">
                    <span className="material-symbols-outlined">rate_review</span> Yêu cầu duyệt đơn thuốc
                  </h3>
                  <button
                    onClick={() => setShowCheckoutModal(false)}
                    className="text-on-surface-variant hover:text-on-surface text-xl"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCheckoutSubmit} className="space-y-4 text-xs sm:text-sm">
                  <div>
                    <label className="block font-semibold mb-1">Họ & Tên người nhận</label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full p-2.5 border rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Số điện thoại</label>
                    <input
                      type="text"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full p-2.5 border rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold mb-1">Địa chỉ giao hàng</label>
                    <input
                      type="text"
                      required
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      className="w-full p-2.5 border rounded-lg focus:ring-1 focus:ring-primary focus:outline-none"
                    />
                  </div>

                  <div className="border-t pt-3">
                    <p className="font-bold mb-2">Tóm tắt đơn thuốc chờ duyệt:</p>
                    <div className="space-y-1 bg-surface-container p-3 rounded-lg text-xs">
                      {cartItems
                        .filter((i) => !i.isDisabled && i.quantity > 0)
                        .map((item) => (
                          <div key={item.id} className="flex justify-between">
                            <span>
                              {item.name} (x{item.quantity})
                            </span>
                            <span className="font-semibold">
                              {(item.price * item.quantity).toLocaleString('vi-VN')}đ
                            </span>
                          </div>
                        ))}
                      <div className="border-t border-outline-variant/60 pt-2 font-bold text-sm flex justify-between text-primary">
                        <span>Tổng tiền dự kiến:</span>
                        <span>{calculateTotal().toLocaleString('vi-VN')}đ</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-primary/5 rounded-lg text-xs text-primary font-medium flex gap-2">
                    <span className="material-symbols-outlined text-base">smart_toy</span>
                    <span>
                      Dược sĩ lâm sàng sẽ kiểm tra tương tác hoạt chất, bệnh nền và dị ứng trước khi phê duyệt đơn thuốc này.
                    </span>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowCheckoutModal(false)}
                      className="flex-1 py-3 border rounded-xl hover:bg-surface-container font-semibold"
                    >
                      Hủy
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-3 bg-primary text-on-primary rounded-xl font-bold hover:bg-surface-tint flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">send</span>
                      Gửi yêu cầu duyệt
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
