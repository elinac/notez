import { describe, it, expect } from 'vitest';
import { detectDiagramType, plantUMLToDot } from '../plantuml-offline/PlantUMLParser';

// ─────────────────────────────────────────────
// detectDiagramType
// ─────────────────────────────────────────────
describe('detectDiagramType', () => {
  it('TP1: 识别类图 - class 关键字', () => {
    expect(detectDiagramType('class Car {\n  +drive()\n}')).toBe('class');
  });
  it('TP2: 识别类图 - interface 关键字', () => {
    expect(detectDiagramType('interface Drivable')).toBe('class');
  });
  it('TP3: 识别类图 - 关系符号', () => {
    expect(detectDiagramType('Vehicle <|-- Car')).toBe('class');
  });
  it('TP4: 识别时序图 - participant 关键字', () => {
    expect(detectDiagramType('participant Alice\nAlice -> Bob : hi')).toBe('sequence');
  });
  it('TP5: 识别时序图 - actor 关键字', () => {
    expect(detectDiagramType('actor User\nUser -> System : request')).toBe('sequence');
  });
  it('TP5b: 时序图 alt/end 不误判为活动图', () => {
    const src = `participant A
participant B
A -> B : x
alt yes
B -> A : y
end`;
    expect(detectDiagramType(src)).toBe('sequence');
  });
  it('TP5c: 含 participant 时 独立一行的括号续行不误判为用例图', () => {
    const src = `participant CloudService
participant SyncModule
CloudService -> SyncModule : 说明
(推送消息触发)`;
    expect(detectDiagramType(src)).toBe('sequence');
  });
  it('TP6: 识别状态图 - [*] 起始', () => {
    expect(detectDiagramType('[*] --> Idle')).toBe('state');
  });
  it('TP7: 识别状态图 - state 关键字', () => {
    expect(detectDiagramType('state Running\nRunning --> Stopped')).toBe('state');
  });
  it('TP8: 识别活动图 - start/stop', () => {
    expect(detectDiagramType('start\n:Do something;\nstop')).toBe('activity');
  });
  it('TP9: 识别活动图 - :action; 格式', () => {
    expect(detectDiagramType(':Process Data;\n:Display Result;')).toBe('activity');
  });
  it('TP10: 识别组件图 - [Component] 关键字', () => {
    expect(detectDiagramType('[WebServer] --> [Database]')).toBe('component');
  });
  it('TP11: 识别用例图 - usecase 关键字', () => {
    // 用例图识别：包含 (UseCase) 括号语法
    expect(detectDiagramType('actor Admin\n(Login)\n(Register)')).toBe('usecase');
  });
  it('TP12: 识别对象图 - object 关键字', () => {
    expect(detectDiagramType('object Car {\n  color = red\n}')).toBe('object');
  });
  it('TP13: 未知类型返回 unknown', () => {
    expect(detectDiagramType('hello world')).toBe('unknown');
  });
});

// ─────────────────────────────────────────────
// Class diagram
// ─────────────────────────────────────────────
describe('classToDoc - 类图转换', () => {
  it('TC1: 基础类节点', () => {
    const source = 'class Animal';
    const { type, dot, supported } = plantUMLToDot(source);
    expect(type).toBe('class');
    expect(supported).toBe(true);
    expect(dot).toContain('Animal');
    expect(dot).toContain('shape=record');
  });

  it('TC2: 含成员的类', () => {
    const source = 'class Car {\n  +String brand\n  +drive()\n}';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('Car');
    expect(dot).toContain('+String brand');
  });

  it('TC3: 继承关系 <|--', () => {
    const source = 'Animal <|-- Dog';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('Animal');
    expect(dot).toContain('Dog');
    expect(dot).toContain('->');
  });

  it('TC4: interface 关键字', () => {
    const source = 'interface Serializable';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('Serializable');
  });

  it('TC5: 多个类与关系', () => {
    const source = `class A\nclass B\nclass C\nA --> B\nB --> C`;
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('"A"');
    expect(dot).toContain('"B"');
    expect(dot).toContain('"C"');
    // 两条 -> 箭头
    const arrows = dot.match(/->/g);
    expect(arrows?.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────
// Sequence diagram
// ─────────────────────────────────────────────
describe('sequenceToDot - 时序图转换', () => {
  it('TS1: 基础消息', () => {
    const source = 'Alice -> Bob : Hello';
    const { type, dot } = plantUMLToDot(source);
    expect(type).toBe('sequence');
    expect(dot).toContain('Alice');
    expect(dot).toContain('Bob');
    expect(dot).toContain('Hello');
  });

  it('TS2: participant 声明', () => {
    const source = 'participant "Web Server" as WS\nWS -> DB : query';
    const { dot } = plantUMLToDot(source);
    // 使用 alias WS 作为 node id，label 为原名
    expect(dot).toContain('WS');
    expect(dot).toContain('Web Server');
    expect(dot).toContain('DB');
  });

  it('TS3: 虚线消息 -->', () => {
    // 需要明确 participant 才能识别为 sequence
    const source = 'participant Alice\nparticipant Bob\nAlice --> Bob : response';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('style=dashed');
  });

  it('TS4: actor 声明', () => {
    const source = 'actor User\nUser -> App : click';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('shape=plaintext');
  });
});

// ─────────────────────────────────────────────
// State diagram
// ─────────────────────────────────────────────
describe('stateToDot - 状态图转换', () => {
  it('TST1: 起始状态 [*]', () => {
    const source = '[*] --> Idle\nIdle --> Running : start\nRunning --> [*] : stop';
    const { type, dot, supported } = plantUMLToDot(source);
    expect(type).toBe('state');
    expect(supported).toBe(true);
    expect(dot).toContain('Idle');
    expect(dot).toContain('Running');
    // 起始节点 (filled black circle)
    expect(dot).toContain('fillcolor=black');
  });

  it('TST2: state 声明', () => {
    const source = 'state Active\nstate Inactive\nActive --> Inactive : disable';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('Active');
    expect(dot).toContain('Inactive');
    expect(dot).toContain('disable');
  });

  it('TST3: 带 label 的 transition', () => {
    const source = '[*] --> Locked\nLocked --> Unlocked : insert coin\nUnlocked --> [*]';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('insert coin');
  });
});

// ─────────────────────────────────────────────
// Activity diagram
// ─────────────────────────────────────────────
describe('activityToDot - 活动图转换', () => {
  it('TA1: start/stop', () => {
    const source = 'start\n:Process;\nstop';
    const { type, dot, supported } = plantUMLToDot(source);
    expect(type).toBe('activity');
    expect(supported).toBe(true);
    expect(dot).toContain('Process');
    expect(dot).toContain('fillcolor=black'); // start node
  });

  it('TA2: if/else/endif', () => {
    const source = 'start\nif (valid?) then (yes)\n  :Accept;\nelse (no)\n  :Reject;\nendif\nstop';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('Accept');
    expect(dot).toContain('Reject');
    expect(dot).toContain('shape=diamond');
  });

  it('TA3: 多个动作节点', () => {
    const source = 'start\n:Read Input;\n:Validate;\n:Save;\nstop';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('Read Input');
    expect(dot).toContain('Validate');
    expect(dot).toContain('Save');
  });
});

// ─────────────────────────────────────────────
// Object diagram
// ─────────────────────────────────────────────
describe('objectToDot - 对象图转换', () => {
  it('TO1: 基础对象', () => {
    const source = 'object Car {\n  color = red\n  speed = 100\n}';
    const { type, dot, supported } = plantUMLToDot(source);
    expect(type).toBe('object');
    expect(supported).toBe(true);
    expect(dot).toContain('Car');
  });

  it('TO2: 对象关系', () => {
    const source = 'object Owner\nobject Car\nOwner --> Car : owns';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('Owner');
    expect(dot).toContain('Car');
    expect(dot).toContain('owns');
  });
});

// ─────────────────────────────────────────────
// Component diagram
// ─────────────────────────────────────────────
describe('componentToDot - 组件图转换', () => {
  it('TComp1: 基础组件', () => {
    const source = '[WebApp]\n[Database]\n[WebApp] --> [Database]';
    const { type, dot, supported } = plantUMLToDot(source);
    expect(type).toBe('component');
    expect(supported).toBe(true);
    expect(dot).toContain('WebApp');
    expect(dot).toContain('Database');
    expect(dot).toContain('->');
  });

  it('TComp2: 虚线依赖', () => {
    const source = '[ServiceA] ..> [ServiceB] : uses';
    const { type, dot } = plantUMLToDot(source);
    expect(type).toBe('component');
    expect(dot).toContain('ServiceA');
    expect(dot).toContain('ServiceB');
  });
});

// ─────────────────────────────────────────────
// Use case diagram
// ─────────────────────────────────────────────
describe('usecaseToDot - 用例图转换', () => {
  it('TUC1: actor + usecase', () => {
    const source = 'actor User\n(Login)\n(Register)\nUser --> (Login)';
    const { type, dot, supported } = plantUMLToDot(source);
    expect(type).toBe('usecase');
    expect(supported).toBe(true);
    expect(dot).toContain('User');
    expect(dot).toContain('Login');
  });

  it('TUC2: 关系 label', () => {
    // actor + usecase 完整语法
    const source = 'actor Admin\n(Manage Users)\nAdmin --> (Manage Users) : manages';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('manages');
  });
});

// ─────────────────────────────────────────────
// Generic fallback
// ─────────────────────────────────────────────
describe('genericToDot - 通用图转换', () => {
  it('TG1: 简单箭头生成节点和边', () => {
    const source = 'A --> B\nB --> C';
    const { dot } = plantUMLToDot(source);
    // unknown or any type - produces valid DOT
    expect(dot).toContain('digraph');
    expect(dot).toContain('A');
    expect(dot).toContain('B');
  });

  it('TG2: 带 @startuml/@enduml 包裹', () => {
    const source = '@startuml\nX --> Y : link\n@enduml';
    const { dot } = plantUMLToDot(source);
    expect(dot).toContain('X');
    expect(dot).toContain('Y');
  });
});
