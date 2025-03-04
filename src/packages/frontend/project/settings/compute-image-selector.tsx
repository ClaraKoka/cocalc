/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

// This is for selecting the "standard" compute images Ubuntu XX.YY, etc.

import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, MenuProps } from "antd";
import { fromJS } from "immutable";

import { Col, Row } from "@cocalc/frontend/antd-bootstrap";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import { Icon, Loading, Space, Text } from "@cocalc/frontend/components";
import { SoftwareEnvironments } from "@cocalc/frontend/customize";
import { unreachable } from "@cocalc/util/misc";
import { COLORS } from "@cocalc/util/theme";

type MenuItem = Required<MenuProps>["items"][number];

const title = (x) => x.get("short") ?? x.get("title") ?? x.get("id") ?? "";

const cmp_title = (a, b) => {
  const t1: string = title(a);
  const t2: string = title(b);
  return t1.toLowerCase() < t2.toLowerCase() ? 1 : -1;
};

// we want "Default", "Previous", ... to come first, hence "order" trumps "short" title
const img_sorter = (a, b): number => {
  const o1 = a.get("order", 0);
  const o2 = b.get("order", 0);
  if (o1 == o2) {
    return cmp_title(a, b);
  }
  return o1 > o2 ? 1 : -1;
};

interface ComputeImageSelectorProps {
  selected_image: string;
  layout: "vertical" | "horizontal";
  onBlur?: () => void;
  onFocus?: () => void;
  onSelect: (e) => void;
}

export const ComputeImageSelector: React.FC<ComputeImageSelectorProps> = (
  props: ComputeImageSelectorProps
) => {
  const { selected_image, onFocus, onBlur, onSelect, layout } = props;

  const software_envs: SoftwareEnvironments | null = useTypedRedux(
    "customize",
    "software"
  );

  if (software_envs === undefined) {
    return <Loading />;
  }

  if (software_envs === null) {
    return null;
  }

  const computeEnvs = fromJS(software_envs.get("environments")).sort(
    img_sorter
  );

  const defaultComputeImg = software_envs.get("default");
  const GROUPS: string[] = software_envs.get("groups").toJS();

  function compute_image_info(name, type) {
    return computeEnvs.getIn([name, type]);
  }

  function compute_image_title(name) {
    return (
      compute_image_info(name, "title") ??
      compute_image_info(name, "tag") ??
      name // last resort fallback, in case the img configured in the project no longer exists
    );
  }

  const default_title = compute_image_title(defaultComputeImg);
  const selected_title = compute_image_title(selected_image);

  function render_menu_children(group: string): MenuItem[] {
    return computeEnvs
      .filter(
        (item) => item.get("group") === group && !item.get("hidden", false)
      )
      .map((img, key) => {
        const registry = img.get("registry");
        const tag = img.get("tag");
        const labelStr = img.get("short") ?? img.get("title") ?? key;
        const label =
          key === defaultComputeImg ? <Text strong>{labelStr}</Text> : labelStr;
        const extra = registry && tag ? ` (${registry}:${tag})` : "";
        const title = `${img.get("descr")}${extra}`;
        return { key, title, label };
      })
      .valueSeq()
      .toJS();
  }

  function render_menu_group(group: string): MenuItem {
    return {
      key: group,
      children: render_menu_children(group),
      label: group,
      type: "group",
    };
  }

  function menu_items(): MenuProps["items"] {
    return GROUPS.map(render_menu_group);
  }

  function getMenu() {
    return {
      onClick: (e) => onSelect(e.key),
      style: { maxHeight: "50vh", overflow: "auto" },
      items: menu_items(),
    };
  }

  function render_selector() {
    return (
      <Dropdown menu={getMenu()} trigger={["click"]}>
        <Button onBlur={onBlur} onFocus={onFocus}>
          {selected_title} <DownOutlined />
        </Button>
      </Dropdown>
    );
  }

  function render_doubt() {
    if (selected_image === defaultComputeImg) {
      return undefined;
    } else {
      return (
        <span style={{ color: COLORS.GRAY, fontSize: "11pt" }}>
          <br /> (If in doubt, select "{default_title}")
        </span>
      );
    }
  }

  function render_info(italic: boolean) {
    const desc = compute_image_info(selected_image, "descr");
    const registry = compute_image_info(selected_image, "registry");
    const tag = compute_image_info(selected_image, "tag");
    const extra = registry && tag ? `(${registry}:${tag})` : null;

    return (
      <Text italic={italic}>
        {desc}
        {extra ? <Text type="secondary"> {extra}</Text> : null}
      </Text>
    );
  }

  switch (layout) {
    case "vertical":
      // used in project settings → project control
      return (
        <Col xs={12}>
          <Row style={{ fontSize: "12pt" }}>
            <Icon name={"hdd"} style={{ marginTop: "5px" }} />
            <Space />
            Selected image
            <Space />
            {render_selector()}
            <Space />
            {render_doubt()}
          </Row>
          <Row>{render_info(true)}</Row>
        </Col>
      );
    case "horizontal":
      // used in projects → create new project
      return (
        <Col xs={12}>
          <Icon name={"hdd"} />
          <Space />
          <span style={{ fontSize: "12pt", fontWeight: "bold" }}>
            {render_selector()}
          </span>
          <span style={{ marginLeft: "10px" }}>{render_info(false)}</span>
        </Col>
      );
    default:
      unreachable(layout);
      return null;
  }
};
