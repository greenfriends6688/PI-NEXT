"use client";

// 画板 web-running / web-new-thread 的 `.side__tools`：新建、搜索、留白、活动。
//
// 画板把「新建」画成铅笔 ghost 钮（30 圆、`--ink-2`、hover 出 `--fill-2`），
// 把搜索画成放大镜；搜索展开时整行收成一条 `.field`。这里先只做两个 ghost 钮，
// 搜索仍用产品原来的那条搜索栏（`design/v3/DIVERGENCE.md` S-2）。
// 活动视图产品没有，`.spacer` 留白保留，位置与画板一致。
import { Icon } from "../v3/Icon";

type Props = {
  newTitle: string;
  newDisabled: boolean;
  onNew: () => void;
  searchTitle: string;
  searchOpen: boolean;
  onSearch: () => void;
  /** 搜索关掉后焦点回到这颗钮（与画板的 .side__tools 同一颗） */
  searchButtonRef?: React.RefObject<HTMLButtonElement | null>;
};

export function SidebarTools({ newTitle, newDisabled, onNew, searchTitle, searchOpen, onSearch, searchButtonRef }: Props) {
  /* 画板的结构是 `.side__tools > 钮 + 钮 + .spacer (+ .field)`：
     分组本身带布局，钮只是它的孩子。以前两颗钮直接挂在 `.sidebar-header` 上，
     类名对得上、结构对不上，侧栏头就永远长不成画板那样。 */
  return (
    <div className={`side__tools${searchOpen ? " is-searching" : ""}`}>
      <button
        type="button"
        className="ghost-btn"
        onClick={onNew}
        disabled={newDisabled}
        title={newTitle}
        aria-label={newTitle}
      >
        <Icon name="square-pencil" />
      </button>
      <button
        ref={searchButtonRef}
        type="button"
        className={`ghost-btn${searchOpen ? " is-on" : ""}`}
        onClick={onSearch}
        title={searchTitle}
        aria-label={searchTitle}
        aria-expanded={searchOpen}
      >
        <Icon name="search" />
      </button>
      <span className="spacer" />
    </div>
  );
}
