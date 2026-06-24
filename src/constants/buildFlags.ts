import type { PlantUmlBackend } from '../store/useSettingsStore';
import { DEFAULT_PLANTUML_BACKEND } from '../store/useSettingsStore';

/** 生产包中展示 PlantUML 引擎切换（仅开发构建为 true） */
export const SHOW_PLANTUML_BACKEND_SWITCH = import.meta.env.DEV;

/** 按是否生产构建解析 PlantUML 后端（供单测覆盖 PROD 分支） */
export function plantUmlBackendForBuild(
  backend: PlantUmlBackend,
  isProduction: boolean,
): PlantUmlBackend {
  return isProduction ? DEFAULT_PLANTUML_BACKEND : backend;
}

/** 生产构建强制 JAR；开发构建尊重用户选择 */
export function effectivePlantUmlBackend(backend: PlantUmlBackend): PlantUmlBackend {
  return plantUmlBackendForBuild(backend, import.meta.env.PROD);
}
