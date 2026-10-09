import type { DocsAuth, mountLivePanel } from './live-browser';

interface SwaggerSystem {
  React: {
    createElement(component: unknown, props: unknown, ...children: unknown[]): unknown;
    useRef<T>(initial: T): { current: T };
    useEffect(effect: () => void | (() => void), dependencies: unknown[]): void;
  };
  authSelectors: { authorized(): { toJS(): DocsAuth } };
}
interface ParameterProps {
  pathMethod?: [string, string];
}
declare global {
  interface Window {
    mountDocsLive: typeof mountLivePanel;
    docsLiveTemplate: string;
  }
}

/** Điểm mở rộng Swagger UI: thay phần nhập tham số SSE bằng khung xem trực tiếp. */
export function docsPlugin() {
  return {
    wrapComponents: {
      parameters: (Original: unknown, system: SwaggerSystem) => {
        const React = system.React;
        function LivePanel() {
          const ref = React.useRef<HTMLElement | null>(null);
          React.useEffect(() => {
            if (!ref.current) return;
            return window.mountDocsLive(ref.current, window.docsLiveTemplate, () =>
              system.authSelectors.authorized().toJS(),
            );
          }, []);
          return React.createElement('section', { ref });
        }
        return (props: ParameterProps) =>
          props.pathMethod?.[0] === '/api/v1/analytics/stream' && props.pathMethod?.[1] === 'get'
            ? React.createElement(LivePanel, null)
            : React.createElement(Original, props);
      },
    },
  };
}
