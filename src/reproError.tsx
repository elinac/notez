import ReactDOM from 'react-dom/client';
import { WysiwygEditor } from './components/WysiwygEditor';
import { PlantUMLRenderer } from './components/PlantUMLRenderer';
import { installDiagramZoomGlobalBridge } from './components/diagramZoom';
import { installDiagramCopyGlobalBridge } from './components/diagramCopy';
import './App.css';

installDiagramZoomGlobalBridge();
installDiagramCopyGlobalBridge();

const content = `# 再现

\`\`\`plantuml
@startuml
skinparam defaultFontName "Microsoft YaHei"
package"日历应用" {
    package "数据层" {
        [日历-日程管理模块] as DataLayer
    end note
\`\`\`
`;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <div>
    <h2>WYSIWYG</h2>
    <div style={{ border: '1px solid #ddd' }} className="milkdown">
      <WysiwygEditor content={content} onChange={() => {}} />
    </div>
    <h2 style={{ marginTop: 40 }}>Split preview</h2>
    <div className="markdown-split-preview" style={{ border: '1px solid #ddd' }}>
      <PlantUMLRenderer content={content} />
    </div>
  </div>
);
