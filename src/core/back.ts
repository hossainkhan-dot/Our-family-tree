import { useEffect, useRef } from "react";
type H = () => void;
const stack: H[] = [];
/** While `active`, the phone's back button runs `fn` first (e.g. close a popup) instead of leaving the screen. */
export function useBack(active: boolean, fn: H): void {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const h = () => ref.current();
    stack.push(h);
    return () => { const i = stack.lastIndexOf(h); if (i >= 0) stack.splice(i, 1); };
  }, [active]);
}
export function runTopBack(): boolean {
  const h = stack[stack.length - 1];
  if (!h) return false;
  h();
  return true;
}
