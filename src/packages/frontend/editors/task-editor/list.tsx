/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

/*
List of Tasks -- we use windowing via Virtuoso, so that even task lists with 500+ tasks are fully usable!
*/

import { List, Set as immutableSet } from "immutable";
import { useEffect, useMemo, useRef } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import useVirtuosoScrollHook from "@cocalc/frontend/components/virtuoso-scroll-hook";
import Task from "./task";
import { TaskActions } from "./actions";
import { LocalTaskStateMap, SelectedHashtags, Tasks } from "./types";
import { useDebouncedCallback } from "use-debounce";
import useIsMountedRef from "@cocalc/frontend/app-framework/is-mounted-hook";

import {
  SortableList,
  SortableItem,
} from "@cocalc/frontend/components/sortable-list";

interface Props {
  actions?: TaskActions;
  path?: string;
  project_id?: string;
  tasks: Tasks;
  visible: List<string>;
  current_task_id?: string;
  local_task_state?: LocalTaskStateMap;
  scrollState?: any;
  scroll_into_view?: boolean;
  font_size: number;
  sortable?: boolean;
  read_only?: boolean;
  selected_hashtags?: SelectedHashtags;
  search_terms?: immutableSet<string>;
}

export default function TaskList({
  actions,
  path,
  project_id,
  tasks,
  visible,
  current_task_id,
  local_task_state,
  scrollState,
  scroll_into_view,
  font_size,
  sortable,
  read_only,
  selected_hashtags,
  search_terms,
}: Props) {
  const mainDivRef = useRef<any>(null);
  const isMountedRef = useIsMountedRef();
  const saveScroll = useDebouncedCallback((scrollState) => {
    if (isMountedRef.current && actions != null) {
      actions.set_local_view_state({ scrollState });
    }
  }, 250);
  const virtuosoScroll = useVirtuosoScrollHook({
    cacheId: actions?.name,
    initialState: scrollState,
    onScroll: saveScroll,
  });
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const selectedHashtags: Set<string> = useMemo(() => {
    const X = new Set<string>([]);
    if (selected_hashtags == null) return X;
    for (const [key] of selected_hashtags) {
      if (selected_hashtags.get(key) == 1) {
        // Note -- we don't have to worry at all about v == -1, since such tasks won't be visible!
        X.add(key);
      }
    }
    return X;
  }, [selected_hashtags]);

  const searchWords: string[] | undefined = useMemo(() => {
    return search_terms?.toJS();
  }, [search_terms]);

  useEffect(() => {
    if (actions && scroll_into_view) {
      _scroll_into_view();
      actions.scroll_into_view_done();
    }
  }, [scroll_into_view]);

  function _scroll_into_view() {
    if (current_task_id == null) {
      return;
    }
    // Figure out the index of current_task_id.
    const index = visible.indexOf(current_task_id);
    if (index === -1) {
      return;
    }
    virtuosoRef.current?.scrollIntoView({ index });
  }

  function render_task(task_id, index?) {
    if (index === visible.size) {
      // Empty div at the bottom makes it possible to scroll
      // the calendar into view...
      return <div style={{ height: "300px" }} />;
    }

    const task = tasks.get(task_id);
    if (task == null) {
      // task deletion and visible list might not quite immediately be in sync/consistent
      return;
    }
    let editing_due_date: boolean;
    let editing_desc: boolean;
    if (actions != null) {
      const state = local_task_state?.get(task_id);
      editing_due_date = !!state?.get("editing_due_date");
      editing_desc = !!state?.get("editing_desc");
    } else {
      editing_due_date = editing_desc = false;
    }
    const body = (
      <Task
        key={task_id}
        actions={actions}
        path={path}
        project_id={project_id}
        task={task}
        is_current={current_task_id === task_id}
        editing_due_date={editing_due_date}
        editing_desc={editing_desc}
        font_size={font_size}
        sortable={sortable}
        read_only={read_only}
        selectedHashtags={selectedHashtags}
        searchWords={searchWords}
      />
    );
    if (!sortable) return body;
    return <SortableItem id={task_id}>{body}</SortableItem>;
  }

  function on_click(e) {
    if (e.target === mainDivRef.current) {
      actions?.enable_key_handler();
    }
  }

  return (
    <SortableList
      disabled={!sortable}
      items={visible.toJS()}
      Item={({ id }) => render_task(id)}
      onDragStop={(oldIndex, newIndex) =>
        actions?.reorder_tasks(oldIndex, newIndex)
      }
    >
      <div
        className="smc-vfill"
        ref={mainDivRef}
        onClick={on_click}
        style={{ overflow: "hidden" }}
      >
        <Virtuoso
          overscan={500}
          ref={virtuosoRef}
          totalCount={visible.size + 1}
          itemContent={(index) =>
            render_task(visible.get(index) ?? `${index}filler`, index)
          }
          {...virtuosoScroll}
        />
      </div>
    </SortableList>
  );
}
