export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 16;

export function normalizeNickname(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function getNicknameError(value: string) {
  const nickname = normalizeNickname(value);
  if (nickname.length < NICKNAME_MIN_LENGTH || nickname.length > NICKNAME_MAX_LENGTH) {
    return `닉네임은 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자로 입력해 주세요.`;
  }
  if (!/^[가-힣a-zA-Z0-9_ ]+$/.test(nickname)) {
    return '닉네임은 한글, 영문, 숫자, 밑줄만 사용할 수 있어요.';
  }
  return null;
}

export function normalizeFriendCode(value: string) {
  return value.trim().toUpperCase().replace(/\s/g, '');
}
