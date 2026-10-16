// A plain JavaScript file: ESLint lints it, and the plugin's rules never see it.
const titles = ['buy milk', 'water the plants'];

export function seedRows() {
  return titles.map((title) => ({ title }));
}
