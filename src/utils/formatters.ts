export function formatConditionToVietnamese(codeOrStr?: string | null): string {
  if (!codeOrStr) return '';
  const map: Record<string, string> = {
    'dai_thao_duong': 'Đái tháo đường (Tiểu đường)',
    'tang_huyet_ap_nang': 'Tăng huyết áp',
    'cao_huyet_ap': 'Cao huyết áp',
    'loet_da_day_ta_trang': 'Loét dạ dày - tá tràng',
    'suy_gan_nang': 'Suy gan',
    'suy_than_nang': 'Suy thận',
    'suy_tim_nang': 'Suy tim',
    'hen_phe_quan': 'Hen phế quản',
    'mang_thai': 'Phụ nữ mang thai',
    'cho_con_bu': 'Phụ nữ cho con bú',
    'nghien_ruou': 'Nghiện rượu',
    'glocom_goc_dong': 'Glôcôm góc đóng',
    'phi_dai_tuyen_tien_liet': 'Phì đại tuyến tiền liệt',
    'cuong_giap': 'Cường giáp',
    'tre_em': 'Trẻ em (<12 tuổi)',
    'nguoi_lon': 'Người lớn (12-59 tuổi)',
    'nguoi_cao_tuoi': 'Người cao tuổi (≥60 tuổi)',
  };

  // Split multi-value string (e.g., "cao_huyet_ap, dai_thao_duong" or "Cao huyết áp, Tiểu đường")
  const parts = codeOrStr.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const formattedParts = parts.map((part) => {
    const norm = part.toLowerCase().replace(/\s+/g, '_');
    if (map[norm]) return map[norm];
    // If it's already accented or custom text, replace underscores with spaces
    return part.replace(/_/g, ' ');
  });

  return formattedParts.join(', ');
}

export function formatAgeGroupToVietnamese(codeOrStr?: string | null): string {
  if (!codeOrStr) return 'Chưa xác định';
  const norm = codeOrStr.trim().toLowerCase().replace(/\s+/g, '_');
  if (norm === 'tre_em') return 'Trẻ em (<12 tuổi)';
  if (norm === 'nguoi_lon') return 'Người lớn (12-59 tuổi)';
  if (norm === 'nguoi_cao_tuoi') return 'Người cao tuổi (≥60 tuổi)';
  return codeOrStr.replace(/_/g, ' ');
}

export function formatAgeDisplay(do_tuoi?: string | number | null, nhom_tuoi?: string | null): string {
  if (do_tuoi === undefined || do_tuoi === null || do_tuoi === '' || do_tuoi === 0 || do_tuoi === '0') {
    if (nhom_tuoi && nhom_tuoi !== '0') return formatAgeGroupToVietnamese(nhom_tuoi);
    return 'Người lớn (mặc định)';
  }

  const rawAge = String(do_tuoi).trim();
  if (!rawAge || rawAge === '0') {
    if (nhom_tuoi && nhom_tuoi !== '0') return formatAgeGroupToVietnamese(nhom_tuoi);
    return 'Người lớn (mặc định)';
  }

  const matchNum = rawAge.match(/\d+/);
  if (matchNum) {
    const ageNum = parseInt(matchNum[0], 10);
    if (ageNum > 0) {
      let group = 'Người lớn';
      if (ageNum < 12) group = 'Trẻ em';
      else if (ageNum >= 60) group = 'Người cao tuổi';
      
      return `${ageNum} tuổi (${group})`;
    }
  }

  const groupLabel = formatAgeGroupToVietnamese(nhom_tuoi || rawAge);
  if (groupLabel && groupLabel !== 'Chưa xác định') return groupLabel;
  return 'Người lớn (mặc định)';
}
