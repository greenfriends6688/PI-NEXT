"use client";

// 画板 web-running / web-new-thread 的 `.side__foot`：一条 `.srow`，齿轮 + 「设置」。
//
// 产品原来在这里并排放 模型 / 技能 / 设置 三个按钮（都只是打开设置面板对应分区的
// 快捷方式）；画板只画一条设置。按画板收成一条，另两个入口仍在设置面板里
// （`design/v3/DIVERGENCE.md` S-3）。
import { Icon } from "../v3/Icon";

type Props = {
  label: string;
  title: string;
  onClick: () => void;
};

export function SidebarFoot({ label, title, onClick }: Props) {
  return (
    <div className="side__foot">
      <button type="button" className="srow" onClick={onClick} title={title}>
        <span className="srow__badge">
          <Icon name="gear" />
        </span>
        <span className="srow__title">{label}</span>
      </button>
    </div>
  );
}
