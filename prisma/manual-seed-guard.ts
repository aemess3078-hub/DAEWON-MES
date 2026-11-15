/**
 * 매뉴얼 로컬 DB 전용 seed 공용 안전장치.
 * DATABASE_URL / DIRECT_URL 이 모두 127.0.0.1:5432/daewon_mes_manual 이고 DEFAULT_TENANT_ID 가 tenant-daewon-manual 이 아니면
 * DB 접속 전에 예외를 던진다. 접속 문자열/비밀번호는 출력하지 않는다.
 * (prisma/seed-manual-master.ts 는 이 파일을 쓰지 않고 같은 규칙을 자체 보유한다 — 기존 seed 보존.)
 */
import * as fs from 'fs';
import * as path from 'path';

export const EXPECT = { host: '127.0.0.1', port: '5432', db: 'daewon_mes_manual', tenant: 'tenant-daewon-manual' } as const;

export function loadDotEnv() {
  // Next.js 규칙대로 .env.local 우선. 이미 설정된 process.env 값이 가장 우선이며 Prisma 도 같은 process.env 를 쓴다.
  for (const name of ['.env.local', '.env']) {
    const file = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
      const m = rawLine.trim().match(/^([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

export function assertLocalTarget(): string {
  loadDotEnv();
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    const raw = process.env[name];
    if (!raw) throw new Error(`[manual-seed] ${name} 가 없습니다. 중단합니다.`);
    let u: URL;
    try { u = new URL(raw); } catch { throw new Error(`[manual-seed] ${name} 형식을 해석할 수 없습니다. 중단합니다.`); }
    const dbName = u.pathname.replace(/^\//, '');
    if (u.hostname !== EXPECT.host || (u.port || '5432') !== EXPECT.port || dbName !== EXPECT.db) {
      throw new Error(`[manual-seed] ${name} 대상이 로컬 매뉴얼 DB(${EXPECT.host}:${EXPECT.port}/${EXPECT.db})가 아닙니다. 중단합니다.`);
    }
  }
  const tenant = process.env.DEFAULT_TENANT_ID?.trim();
  if (tenant !== EXPECT.tenant) throw new Error(`[manual-seed] DEFAULT_TENANT_ID 가 ${EXPECT.tenant} 가 아닙니다. 중단합니다.`);
  // 안전장치 2: 실서비스(Supabase) 식별자가 환경에 섞여 있으면 중단
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DATABASE_URL|DIRECT_URL|SUPABASE_.*|NEXT_PUBLIC_SUPABASE_.*)$/.test(k) && v && /supabase|aquqetajewvhyirmewfy/i.test(v)) {
      throw new Error(`[manual-seed] 환경변수 ${k} 가 운영(Supabase)을 가리킵니다. 중단합니다.`);
    }
  }
  return tenant;
}
