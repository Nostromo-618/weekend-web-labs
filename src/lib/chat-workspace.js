import { onActivated, onBeforeUnmount, onMounted, ref } from 'vue';

/** Workspace height only. Settings open in a modal and never resize this layout. */
export function useChatWorkspace() {
  const root = ref(null);
  const height = ref('calc(100dvh - 12rem)');
  let observer, frame;
  function measure() {
    if (!root.value?.isConnected) return;
    const rect = root.value.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
    // Once the workspace scrolls above the viewport, keep its size so docs below stay reachable.
    if (rect.top >= 0 && rect.top < bottom)
      height.value = `${Math.max(320, bottom - rect.top - 12)}px`;
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  }
  onMounted(() => {
    measure();
    observer = new window.ResizeObserver(schedule);
    observer.observe(root.value);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
  });
  onActivated(schedule);
  onBeforeUnmount(() => {
    observer?.disconnect();
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
  });
  return { root, height };
}
