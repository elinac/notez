/** PlantUML 内置 theme（名称需与随包 plantuml.jar 一致） */
export const DEFAULT_PLANTUML_THEME = 'bluegray';

export interface PlantUmlThemeOption {
  value: string;
  label: string;
}

/** 设置下拉：常用官方 theme，非完整列表 */
export const PLANTUML_THEME_OPTIONS: PlantUmlThemeOption[] = [
  { value: 'bluegray', label: 'Blue Gray' },
  { value: 'cerulean', label: 'Cerulean' },
  { value: 'cerulean-outline', label: 'Cerulean Outline' },
  { value: 'reddress-darkblue', label: 'Reddress Dark Blue' },
  { value: 'reddress-darkorange', label: 'Reddress Dark Orange' },
  { value: 'reddress-darkred', label: 'Reddress Dark Red' },
  { value: 'reddress-lightblue', label: 'Reddress Light Blue' },
  { value: 'reddress-lightgreen', label: 'Reddress Light Green' },
  { value: 'mars', label: 'Mars' },
  { value: 'mimeograph', label: 'Mimeograph' },
  { value: 'plain', label: 'Plain' },
  { value: 'sketchy', label: 'Sketchy' },
  { value: 'spacelab', label: 'Spacelab' },
  { value: 'spacelab-white', label: 'Spacelab White' },
  { value: 'toy', label: 'Toy' },
];
