// Метка у строки темы в списке слабых тем: точка, когда тему пора повторить.
//
// Без чисел и без кольца: шанс вспомнить ученику не показываем, а заполненное кольцо
// раньше значило «помню хорошо» и читалось бы наоборот.

export function DueMark({ due }: { due: boolean }) {
  return due ? (
    <span className="tp-due is-on" role="img" aria-label="пора" title="пора" />
  ) : (
    <span className="tp-due" aria-hidden="true" />
  );
}
