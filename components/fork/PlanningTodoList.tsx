"use client";

import { useI18n } from "@/hooks/useI18n";
import { dueTone, endOfLocalDay, startOfLocalDay } from "@/lib/planning-calendar";
import type { PlanningGroup, PlanningTag } from "@/lib/planning-types";
import type { PlanningTodoView, TodoFilterStatus, TodoViewFilter } from "@/lib/planning-view";

/*
 * fork:proma-44-planning —— Todo 列表页。
 *
 * 行高 / hover 复用画板 `.pw-trow`，这里只补「勾选框 + 标题 + 元信息」三段式与
 * 逾期/今天两档语义色（都在 `app/fork-ui.css` 的 `.fork-plan-item*`）。
 *
 * 排序与过滤**不在这里**做（那是 `lib/planning-view.ts` 的纯函数，有单测），
 * 组件只负责把切好的 view model 画出来。
 */

interface Props {
  todos: PlanningTodoView[];
  now: number;
  view: TodoViewFilter;
  status: TodoFilterStatus;
  groups: PlanningGroup[];
  tags: PlanningTag[];
  selectedId: string | null;
  openTodoCount: number;
  onSelect: (id: string) => void;
  onToggleDone: (todo: PlanningTodoView) => void;
  onViewChange: (view: TodoViewFilter) => void;
  onStatusChange: (status: TodoFilterStatus) => void;
  onNewTodo: () => void;
  onNewGroup: () => void;
  onNewTag: () => void;
}

function formatDue(value: number, now: number): string {
  const date = new Date(value);
  const sameDay = dueTone(value, now) === "today";
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return time;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}-${day} ${time}`;
}

const STATUS_TABS: TodoFilterStatus[] = ["open", "all", "completed"];

export function PlanningTodoList({
  todos,
  now,
  view,
  status,
  groups,
  tags,
  selectedId,
  openTodoCount,
  onSelect,
  onToggleDone,
  onViewChange,
  onStatusChange,
  onNewTodo,
  onNewGroup,
  onNewTag,
}: Props) {
  const { t } = useI18n();
  const todayStart = startOfLocalDay(now);

  const views: Array<{ id: TodoViewFilter; label: string; count: number }> = [
    { id: "all", label: t("planning.filter.all"), count: todos.length },
    {
      id: "today",
      label: t("planning.filter.today"),
      count: todos.filter((todo) => todo.status === "open" && todo.dueAt !== undefined && todo.dueAt >= todayStart && todo.dueAt < endOfLocalDay(now)).length,
    },
    {
      id: "overdue",
      label: t("planning.filter.overdue"),
      count: todos.filter((todo) => todo.status === "open" && todo.dueAt !== undefined && todo.dueAt < todayStart).length,
    },
    ...groups.map((group) => ({
      id: `group:${group.id}` as TodoViewFilter,
      label: group.name,
      count: todos.filter((todo) => todo.groupId === group.id).length,
    })),
    ...tags.map((tag) => ({
      id: `tag:${tag.id}` as TodoViewFilter,
      label: `#${tag.name}`,
      count: todos.filter((todo) => todo.tagIds.includes(tag.id)).length,
    })),
  ];

  return (
    <div className="fork-plan-list">
      <div className="fork-plan-list-head">
        <span className="fork-plan-count">{t("planning.todoCount", { count: openTodoCount })}</span>
        <span className="grow" />
        <button type="button" className="pw-iconbtn" onClick={onNewGroup} title={t("planning.group.new")} aria-label={t("planning.group.new")}>
          <span className="pw-ico"><i data-ico="folder-plus" data-size="14"></i></span>
        </button>
        <button type="button" className="pw-iconbtn" onClick={onNewTag} title={t("planning.tag.new")} aria-label={t("planning.tag.new")}>
          <span className="pw-ico"><i data-ico="tag" data-size="14"></i></span>
        </button>
        <button type="button" className="pw-btn sm" onClick={onNewTodo}>
          <span className="pw-ico"><i data-ico="plus" data-size="14"></i></span>
          {t("planning.newTodo")}
        </button>
      </div>

      <div className="fork-plan-filter" role="tablist" aria-label={t("planning.filter.label")}>
        {STATUS_TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={status === item}
            className={`pw-chip${status === item ? " is-on" : ""}`}
            onClick={() => onStatusChange(item)}
          >
            {t(`planning.status.${item}`)}
          </button>
        ))}
      </div>

      <div className="fork-plan-filter" role="tablist" aria-label={t("planning.filter.label")}>
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={view === item.id}
            className={`pw-chip${view === item.id ? " is-on" : ""}`}
            onClick={() => onViewChange(item.id)}
          >
            {item.label}
            <span className="pw-badge count">{item.count}</span>
          </button>
        ))}
      </div>

      <div className="fork-plan-scroll">
        {todos.length === 0 ? (
          <div className="pw-empty">
            <div className="pw-empty-inner">
              <h2>{t("planning.empty.title")}</h2>
              <p>{t("planning.empty.hint")}</p>
            </div>
          </div>
        ) : todos.map((todo) => {
          const tone = todo.dueAt === undefined ? "none" : dueTone(todo.dueAt, now);
          const done = todo.status === "completed";
          return (
            <div
              key={todo.id}
              className={`pw-trow fork-plan-item${todo.id === selectedId ? " is-on" : ""}${done ? " is-done" : ""}`}
              role="option"
              aria-selected={todo.id === selectedId}
              tabIndex={0}
              onClick={() => onSelect(todo.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(todo.id);
                }
              }}
            >
              <button
                type="button"
                className={`fork-plan-check${done ? " is-on" : ""}`}
                aria-pressed={done}
                aria-label={done ? t("planning.reopen") : t("planning.markDone")}
                onClick={(event) => { event.stopPropagation(); onToggleDone(todo); }}
              >
                <span className="pw-ico"><i data-ico="check" data-size="10"></i></span>
              </button>
              <div>
                <span className="fork-plan-item-title">{todo.title}</span>
                <span className="fork-plan-item-meta" data-tone={tone}>
                  {todo.dueAt !== undefined && <span>{formatDue(todo.dueAt, now)}</span>}
                  {todo.group && <span>· {todo.group.name}</span>}
                  {todo.tags.map((tag) => <span key={tag.id}>· #{tag.name}</span>)}
                  {todo.priority !== "medium" && <span>· {t(`planning.priority.${todo.priority}`)}</span>}
                  {todo.reminders.length > 0 && (
                    <span className="pw-ico" title={t("planning.detail.reminders")}>
                      <i data-ico="bell" data-size="11"></i>
                    </span>
                  )}
                </span>
              </div>
              {todo.sessionLinks.length > 0 && (
                <span className="pw-ico" title={t("planning.detail.sessions")}>
                  <i data-ico="bot" data-size="13"></i>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
