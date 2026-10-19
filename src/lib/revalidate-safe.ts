/**
 * DB 커밋 이후의 캐시 재검증(revalidatePath) 오류가 업무 결과를 뒤집지 않도록 하는 헬퍼.
 *
 * 문제: 트랜잭션이 커밋돼 입고/출고/등록이 이미 끝났는데 `revalidatePath` 가 throw 하면
 * 바깥 catch 가 "실패"를 반환해, 사용자가 다시 저장하면서 같은 처리를 한 번 더 하게 된다.
 * 해결: 후처리 오류는 서버 로그에만 남기고 호출부에는 성공으로 돌려준다 (화면은 다음 조회 때 갱신된다).
 *
 * 이 모듈은 next/cache 를 직접 import 하지 않는다(테스트 주입 가능). 호출부가 revalidatePath 를 넘긴다.
 */

export function safeRevalidate(
  revalidate: (path: string) => void,
  paths: readonly string[],
  scope: string
): string[] {
  const failed: string[] = []
  for (const path of paths) {
    try {
      revalidate(path)
    } catch (error) {
      failed.push(path)
      // 이미 커밋된 뒤의 후처리 오류 — 사용자에게 실패로 알리지 않고 서버 로그에만 남긴다
      console.error(`[${scope}] post-commit revalidate failed (${path}):`, error)
    }
  }
  return failed
}
