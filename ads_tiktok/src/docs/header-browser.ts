export function mountDocsHeader(template: string) {
  let viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.append(viewport);
  }
  viewport.content = 'width=device-width, initial-scale=1';
  const header = document.createElement('header');
  header.className = 'docs-header';
  header.innerHTML = template;
  document.querySelector('#swagger-ui')?.before(header);
}
