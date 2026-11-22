const allowedPasswordSymbols = `!@#$%^&*()_+-=[]{};':"|<>?,./\`~\\`;

export type PasswordRequirement = {
  id: 'length' | 'uppercase' | 'symbol';
  label: string;
  met: boolean;
};

export function getSignupPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    { id: 'length', label: '8자 이상', met: Array.from(password).length >= 8 },
    { id: 'uppercase', label: '영문 대문자 포함', met: /[A-Z]/.test(password) },
    { id: 'symbol', label: '특수문자 포함', met: Array.from(password).some((character) => allowedPasswordSymbols.includes(character)) },
  ];
}

export function getSignupPasswordError(password: string, confirmation: string): string | null {
  const unmet = getSignupPasswordRequirements(password).filter((requirement) => !requirement.met);
  if (unmet.length) return `비밀번호에 ${unmet.map((requirement) => requirement.label).join(', ')} 조건을 충족해 주세요.`;
  if (password !== confirmation) return '비밀번호 확인이 일치하지 않아요.';
  return null;
}
