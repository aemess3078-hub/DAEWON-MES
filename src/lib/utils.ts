import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind CSS 클래스 병합 유틸리티
 * shadcn/ui 표준 패턴
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 필드 key 생성: 한글 이름을 영문 snake_case로 변환
 * "품목코드" -> "item_code" 직접 변환은 불가하므로
 * 영문 입력을 snake_case로 정규화하는 용도로 사용
 */
export function toSnakeCase(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * UUID v4 생성 (crypto API 사용)
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 날짜 포맷 (한국 로케일)
 */
export function formatDate(date: Date | string, includeTime = false): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime && { hour: '2-digit', minute: '2-digit' }),
  };
  return d.toLocaleDateString('ko-KR', options);
}

/**
 * API 에러 메시지 추출
 */
export function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : null;

  if (message === 'FORBIDDEN') return '권한이 없습니다.';
  if (message === 'UNAUTHORIZED') return '로그인이 필요합니다.';
  if (message) return message;

  return '알 수 없는 오류가 발생했습니다.';
}

/**
 * 숫자 포맷 (천단위 콤마)
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ko-KR').format(value);
}

// ─── 업무 수량/통화 표시 포맷터 ──────────────────────────────────────────────
//
// formatNumber()는 순수 number만 받고 내부적으로 Intl.NumberFormat이 number로
// 변환하므로, Prisma Decimal이 문자열로 직렬화되어 오는 경우(특히 Decimal(18,6)
// 수량 필드)에는 이미 number 변환 시점에 유효 자릿수가 15~17자리로 잘릴 위험이
// 있다. formatQuantity/formatCurrency는 문자열 입력을 Number()로 변환하지 않고
// 자릿수만 그대로 재배치("."/부호는 그대로 두고 정수부에만 콤마 삽입)해서
// precision 손실을 피한다.
//
// 반드시 identifier(orderNo/manufacturingNo/LOT번호/사업자등록번호/우편번호/
// 전화번호/버전/문서번호 등 "숫자처럼 보이지만 식별자"인 값)에는 사용하지
// 않는다 — 그런 값은 애초에 이 함수들에 넘기면 안 된다.

function splitNumericSign(raw: string): { negative: boolean; digits: string } {
  const negative = raw.startsWith('-');
  return { negative, digits: negative ? raw.slice(1) : raw };
}

function insertThousandsSeparators(integerDigits: string): string {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "007" -> "7", "0" -> "0" (정수부 선행 0 정규화, 단독 "0"은 유지) */
function stripLeadingZeros(integerDigits: string): string {
  const stripped = integerDigits.replace(/^0+(?=\d)/, '');
  return stripped === '' ? '0' : stripped;
}

const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

export interface FormatQuantityOptions {
  /** 표시할 최대 소수 자릿수. Decimal(18,6) 필드 기준 기본값 6. */
  maxDecimals?: number;
}

/**
 * 업무 수량(quantity) 표시 포맷터 — 천 단위 콤마 + precision 보존.
 * - number 또는 문자열(Decimal 직렬화 값)을 모두 받는다. 문자열은 Number()로
 *   변환하지 않고 문자 그대로 자릿수만 재배치한다.
 * - 소수는 maxDecimals(기본 6)까지 표시하고, 그 이상은 반올림 없이 잘라낸다
 *   (사용자가 입력/저장한 값 이상으로 반올림해서 보여주지 않기 위함).
 * - 불필요한 trailing zero는 제거한다(1234.500000 -> "1,234.5", 1234.000000 -> "1,234").
 * - null/undefined/파싱 불가능한 값은 "-"를 반환한다(읽기 전용 표시 전용 —
 *   입력 필드에는 이 값을 그대로 쓰지 말 것, QuantityInput 참고).
 */
export function formatQuantity(
  value: number | string | null | undefined,
  options: FormatQuantityOptions = {}
): string {
  if (value === null || value === undefined) return '-';

  const raw = typeof value === 'number' ? String(value) : value.trim();
  if (!NUMERIC_STRING_PATTERN.test(raw)) return '-';

  const maxDecimals = options.maxDecimals ?? 6;
  const { negative, digits } = splitNumericSign(raw);
  const [integerPart, decimalPart = ''] = digits.split('.');

  const trimmedDecimal = decimalPart.slice(0, maxDecimals).replace(/0+$/, '');
  const formattedInteger = insertThousandsSeparators(stripLeadingZeros(integerPart));
  const formatted = trimmedDecimal ? `${formattedInteger}.${trimmedDecimal}` : formattedInteger;

  return negative && formatted !== '0' ? `-${formatted}` : formatted;
}

export interface FormatCurrencyOptions {
  /** 'suffix'(기본) -> "1,250,000원", 'plain' -> "1,250,000"(라벨에 별도 "(원)" 붙일 때) */
  display?: 'suffix' | 'plain';
}

/**
 * KRW 금액 표시 포맷터. DB/API에 저장된 currency 코드("KRW")는 절대 건드리지
 * 않고, 화면에만 "원" 접미사로 표기한다. 금액은 정수 단위로 표시한다
 * (KRW는 소수 단위를 쓰지 않음 — 기존 MoneyInput과 동일한 정수 전제).
 */
export function formatCurrency(
  value: number | string | null | undefined,
  options: FormatCurrencyOptions = {}
): string {
  const formatted = formatQuantity(value, { maxDecimals: 0 });
  if (formatted === '-') return '-';
  return options.display === 'plain' ? formatted : `${formatted}원`;
}

export interface FormatAmountWithCurrencyOptions {
  /** 통화가 KRW가 아닐 때 표시할 최대 소수 자릿수(기본 2 — 대부분의 통화 subunit 관례). */
  maxDecimals?: number;
}

/**
 * 통화 코드를 함께 받아 표시하는 금액 포맷터. currency가 정확히 "KRW"일 때만
 * formatCurrency()로 "원" 접미사를 붙이고, 그 외 통화(USD/EUR/JPY 등 자유
 * 입력 포함)는 코드를 그대로 유지한 채 formatQuantity()로 표시한다 —
 * 모든 금액에 무조건 "원"을 붙이면 외화 금액이 잘못 표기되기 때문이다.
 * DB에 저장된 currency 값은 어디에서도 변경하지 않는다.
 *
 * sales-orders/format-amount.ts와 정책이 동일하다(다른 모듈에서도 같은 요구가
 * 생겨 여기 lib 레벨로 옮겼다) — 이미 merge된 그 파일은 그대로 두고 중복을
 * 감수했다. 화면마다 값의 통화가 KRW 고정이 아니라 실제로 여러 통화를 받는
 * 경우에만 이 함수를 쓴다.
 */
export function formatAmountWithCurrency(
  amount: number | string | null | undefined,
  currency: string,
  options: FormatAmountWithCurrencyOptions = {}
): string {
  if (currency === 'KRW') return formatCurrency(amount);
  const formatted = formatQuantity(amount, { maxDecimals: options.maxDecimals ?? 2 });
  if (formatted === '-') return '-';
  return `${formatted} ${currency}`;
}

/**
 * 0~1 사이 비율(defectRate, availability rate 등 기존 정본 계산 결과)을
 * "12.3%" 형태로 표시한다. 기존 화면들(defect-stats-client.tsx 등)이 각자
 * `(rate * 100).toFixed(n) + '%'`로 반복 구현하던 것을 리포트 3종에서 함께
 * 쓰기 위해 공용화했다 — rate 계산 자체(분자/분모 정의)는 건드리지 않고
 * 표시 포맷만 통일한다. null/undefined는 "-"를 반환한다.
 */
export function formatPercent(
  ratio: number | null | undefined,
  decimals = 1
): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '-';
  return `${(ratio * 100).toFixed(decimals)}%`;
}

/**
 * "1,234.56" 같은 콤마 포함 표시 문자열을 raw number로 되돌린다(입력 파싱 /
 * UI<->서버 storage boundary 용). 빈 문자열이나 숫자가 아닌 값은 예외를
 * 던지지 않고 undefined를 반환한다.
 */
export function parseFormattedNumber(text: string | null | undefined): number | undefined {
  if (text === null || text === undefined) return undefined;
  const withoutCommas = text.trim().replace(/,/g, '');
  if (!NUMERIC_STRING_PATTERN.test(withoutCommas)) return undefined;
  const num = Number(withoutCommas);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * 배열에서 특정 키 기준 중복 제거
 */
export function uniqueBy<T>(array: T[], key: keyof T): T[] {
  const seen = new Set();
  return array.filter((item) => {
    const k = item[key];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 객체 배열을 특정 키 기준으로 Map으로 변환
 */
export function indexBy<T>(array: T[], key: keyof T): Map<unknown, T> {
  return new Map(array.map((item) => [item[key], item]));
}
