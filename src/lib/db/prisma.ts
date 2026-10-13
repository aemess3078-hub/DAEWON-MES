/**
 * Prisma 클라이언트 싱글턴
 * Next.js 개발 환경에서 HMR로 인한 다중 인스턴스 생성을 방지합니다.
 *
 * Connection pool 튜닝:
 *   PRISMA_CONNECTION_LIMIT  - 인스턴스당 최대 DB 커넥션 수 (기본값: 2)
 *   PRISMA_POOL_TIMEOUT      - 빈 커넥션 대기 제한(초) (기본값: 10)
 *
 * 웹서버/운영 환경에서는 .env 또는 호스팅 환경변수에서 조절:
 *   PRISMA_CONNECTION_LIMIT=8   ← Supabase pooler 한도 내에서 테스트 권장
 *   PRISMA_POOL_TIMEOUT=10
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildDatabaseUrl(): string {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return '';

  // URL 객체로 파라미터를 안전하게 set:
  //   - ? / & 연결 꼬임 없음
  //   - DATABASE_URL에 기존 connection_limit이 있어도 env 값으로 override
  //   - sslmode 등 기존 파라미터는 그대로 보존
  const url = new URL(rawUrl);
  url.searchParams.set('connection_limit', process.env.PRISMA_CONNECTION_LIMIT ?? '2');
  url.searchParams.set('pool_timeout',     process.env.PRISMA_POOL_TIMEOUT     ?? '10');
  url.searchParams.set('connect_timeout',  process.env.PRISMA_CONNECT_TIMEOUT  ?? '10');

  // Supabase transaction pooler(6543, PgBouncer transaction mode)는 prepared statement를
  // 지원하지 않는다. pgbouncer=true가 없으면 Prisma가 prepared statement를 사용해
  // "prepared statement \"sN\" already exists" 류의 오류로 모든 쿼리(로그인 포함)가 실패한다.
  // 5432 session pooler/direct 접속에서는 추가하지 않는다.
  if (url.port === '6543' && !url.searchParams.has('pgbouncer')) {
    url.searchParams.set('pgbouncer', 'true');
  }

  return url.toString();
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: buildDatabaseUrl() } },
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
