export const SALEBASE_SCRIPTS_URL = 'https://salebase.ai/phone_scripts/phone_scripts.php';

// Salebase's visible dropdown labels. IMPACT sends the request type as text,
// so the matching stays readable and can handle small wording differences.
export function salebaseOptionForRequestType(requestType) {
  const type = String(requestType || '').toLowerCase();
  if (/response\s*card/.test(type)) return 'Response Card';
  if (/will\s*kit/.test(type)) return 'Will Kit';
  if (/mediaplex/.test(type)) return 'MediaPlex';
  if (/child\s*safe.*referral/.test(type)) return 'Child Safe Referral';
  if (/child\s*safe/.test(type)) return 'Child Safe';
  if (/pos.*beneficiar|beneficiar.*pos/.test(type)) return 'POS Beneficiary';
  if (/pos.*laps|laps.*pos/.test(type)) return 'POS Lapsed';
  if (/globe.*laps|laps.*globe/.test(type)) return 'Globe Lapse';
  if (/\bglobe\b/.test(type)) return 'Globe';
  if (/ailplus.*non.?customer|non.?customer.*ailplus/.test(type)) return 'AILPlus (Non-Customer)';
  if (/ailplus/.test(type)) return 'AILPlus';
  if (/final\s*expense/.test(type)) return 'Final Expense';
  return '';
}
