/*
 *  This file is part of CoCalc: Copyright © 2022 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { PoweroffOutlined } from "@ant-design/icons";
import { Table, Typography } from "antd";

import { React, useMemo, useTypedRedux } from "@cocalc/frontend/app-framework";
import { A, NoWrap, QuestionMarkText, Tip } from "@cocalc/frontend/components";
import { DOC_CLOUD_STORAGE_URL } from "@cocalc/util/consts/project";
import { KUCALC_COCALC_COM } from "@cocalc/util/db-schema/site-defaults";
import { plural } from "@cocalc/util/misc";
import { PROJECT_UPGRADES } from "@cocalc/util/schema";
import { COLORS } from "@cocalc/util/theme";
import { DedicatedResources } from "@cocalc/util/types/dedicated";
import { upgrade2quota_key, Upgrades } from "@cocalc/util/upgrades/quota";
import { Project } from "../types";
import { renderBoolean } from "./components";
import {
  useCurrentUsage,
  useDisplayedFields,
  useMaxUpgrades,
  useRunQuota,
} from "./hooks";
import {
  booleanValueStr,
  QuotaData,
  QUOTAS_BOOLEAN,
  RunQuotaType,
  SHOW_MAX,
  Usage,
  Value,
} from "./misc";

const { Text } = Typography;
const PARAMS = PROJECT_UPGRADES.params;

const INFINITY_CHAR = "∞";

interface Props {
  project_id: string;
  project_state?: "opened" | "running" | "starting" | "stopping";
  project: Project;
  dedicated_resources?: DedicatedResources;
}

export const RunQuota: React.FC<Props> = React.memo((props: Props) => {
  const { project_id, project_state, dedicated_resources } = props;
  const projectIsRunning = project_state === "running";
  //const projectStatus = project.get("status");
  const currentUsage = useCurrentUsage({ project_id });
  const kucalc = useTypedRedux("customize", "kucalc");
  const cocalcCom = kucalc === KUCALC_COCALC_COM;
  const runQuota = useRunQuota(project_id, null);
  const maxUpgrades = useMaxUpgrades();
  const displayedFields = useDisplayedFields();

  const onDedicatedVM: boolean = useMemo(() => {
    return dedicated_resources?.vm != null && dedicated_resources?.vm !== false;
  }, [dedicated_resources]);

  function quotaValue(key: keyof RunQuotaType): Value {
    const val = runQuota[key];
    if (val == null) return "N/A";
    return val;
  }

  function displayedName(name: keyof Upgrades): string {
    if (name === "cores") return "CPU";
    if (name === "memory") return "Memory";
    return PARAMS[name]?.display ?? name;
  }

  function getMaxDedicated(name: keyof Upgrades) {
    if (name === "memory") return maxUpgrades?.["memory_request"] ?? "N/A";
    if (name === "cores") return maxUpgrades?.["cpu_shares"] ?? "N/A";
  }

  function getQuotaDedicated(name: keyof Upgrades) {
    if (name === "memory") return quotaValue("memory_request");
    if (name === "cores") return quotaValue("cpu_request");
  }

  const data: QuotaData[] = React.useMemo(() => {
    const ar = !!runQuota.always_running;
    return displayedFields.map((name: keyof Upgrades): QuotaData => {
      const key = upgrade2quota_key(name);
      return {
        key,
        display: displayedName(name),
        desc: PARAMS[name]?.desc ?? "",
        quota: key == "idle_timeout" && ar ? INFINITY_CHAR : quotaValue(key),
        quotaDedicated: getQuotaDedicated(name),
        maximum: maxUpgrades?.[name] ?? "N/A",
        maxDedicated: getMaxDedicated(name),
        usage: currentUsage?.[key],
      };
    });
  }, [runQuota, currentUsage, maxUpgrades, projectIsRunning]);

  function renderExtraMaximum(record: QuotaData): JSX.Element | undefined {
    if (SHOW_MAX.includes(record.key)) {
      return (
        <>
          The maximum possible quota is {record.maximum}
          {record.maxDedicated != null && (
            <>, of which {record.maxDedicated} could be dedicated</>
          )}
          .
        </>
      );
    }
  }

  function renderExtraExplanation(record: QuotaData): JSX.Element {
    if (onDedicatedVM) return <></>;

    const dedicatedVM = (
      <>
        If you need more RAM or CPU, consider upgrading to a{" "}
        <A href={"https://cocalc.com/pricing/dedicated"}>Dedicated VM</A>.
      </>
    );

    const dedicatedDisk = (
      <>
        It is possible to rent a{" "}
        <A href={"https://cocalc.com/pricing/dedicated"}>Dedicated Disk</A> for
        much more storage, or attach{" "}
        <A href={DOC_CLOUD_STORAGE_URL}>files hosted online</A>.
      </>
    );

    const idleTimeoutInfo = (
      <>
        To increase the idle timeout, either purchase a new license with a
        larger timeout period or the "always running" quota.
      </>
    );

    switch (record.key) {
      case "memory_request":
      case "memory_limit":
      case "cpu_limit":
      case "cpu_request":
        return cocalcCom ? dedicatedVM : <></>;
      case "disk_quota":
        return cocalcCom ? dedicatedDisk : <></>;
      case "idle_timeout":
        // special case: if we have always running, don't tell the user to increase idle timeout (stupid)
        return record.quota != INFINITY_CHAR ? idleTimeoutInfo : <></>;
      default:
        return <></>;
    }
  }

  function renderQuotaValue(record: QuotaData): string {
    const { key, quota, quotaDedicated, usage } = record;
    if (QUOTAS_BOOLEAN.includes(key as any)) {
      return `This quota is ${booleanValueStr(quota)}.`;
    } else if (key === "patch") {
      return usage != null
        ? `There are ${usage.display} ${plural(
            usage.display,
            "patch",
            "patches"
          )} in total.`
        : ``;
    } else {
      const curStr =
        usage != null
          ? `Usage right now is ${usage.display} with a limit of ${quota}`
          : `The limit is ${quota}`;
      const dediStr =
        !onDedicatedVM && quotaDedicated != null
          ? `, of which ${quotaDedicated} are dedicated to this project.`
          : ".";
      return `${curStr}${dediStr}`;
    }
  }

  function renderDedicatedVMExtra(record: QuotaData): JSX.Element {
    const desc = (function () {
      switch (record.key) {
        case "memory_limit":
        case "memory_request":
          return "Project runs on a Dedicated VM and can use up all of its memory.";
        case "cpu_limit":
        case "cpu_request":
          return "Project runs on a Dedicated VM and can use up all of its CPU.";
        default:
          return record.desc;
      }
    })();
    return (
      <>
        {desc} {renderQuotaValue(record)}
      </>
    );
  }

  function renderExtra(record: QuotaData): JSX.Element {
    if (onDedicatedVM) {
      return renderDedicatedVMExtra(record);
    } else {
      return (
        <>
          {record.desc} {renderQuotaValue(record)} {renderExtraMaximum(record)}{" "}
          {renderExtraExplanation(record)}
        </>
      );
    }
  }

  function renderUsage(record: QuotaData): JSX.Element | undefined {
    if (!projectIsRunning) return;
    // the usage of a boolean quota is always the same as its value
    if (QUOTAS_BOOLEAN.includes(record.key as any)) return;
    if (record.key === "patch") return;
    const usage: Usage = record.usage;
    if (usage == null) return;
    const { element } = usage;
    // wrapped in "Text", because that works better with the table layout
    return <NoWrap>{element}</NoWrap>;
  }

  function renderQuotaLimit(record: QuotaData) {
    const val = record["quota"];

    const style = projectIsRunning ? {} : { color: COLORS.GRAY_L };

    if (record.key === "idle_timeout" && val === "&infin;") {
      return (
        <QuestionMarkText tip="If the project stops or the underlying VM goes into maintenance, the project will automatically restart.">
          &infin;
        </QuestionMarkText>
      );
    }

    if (typeof val === "boolean") {
      return renderBoolean(val, projectIsRunning);
    } else if (typeof val === "number") {
      if (record.key === "idle_timeout") {
        return val;
      }
    } else if (Array.isArray(val)) {
      return val.length;
    } else {
      return (
        <Text strong={true} style={style}>
          <NoWrap>{val}</NoWrap>
        </Text>
      );
    }
  }

  function renderValueColumnTitle(): JSX.Element {
    if (projectIsRunning) {
      return (
        <QuestionMarkText tip="Usage limit imposed by the current quota configuration. Add a license to change this limit or adjust your quota upgrade contribution. Project needs to run in order to see the effective runtime quota.">
          Value
        </QuestionMarkText>
      );
    } else {
      return (
        <Tip
          tip={`The project is currently not running. The data is stale from the last run. Start the project to see the effective quotas.`}
        >
          Value <PoweroffOutlined style={{ color: COLORS.ANTD_RED_WARN }} />
        </Tip>
      );
    }
  }

  function renderQuotas() {
    return (
      <Table<QuotaData>
        dataSource={data}
        size="small"
        pagination={false}
        rowClassName={() => "cursor-pointer"}
        expandable={{
          expandedRowRender: (record) => renderExtra(record),
          expandRowByClick: true,
        }}
      >
        <Table.Column<QuotaData>
          key="key"
          title={
            <QuestionMarkText tip="Name of the quota. Click on a row to expand details.">
              Name
            </QuestionMarkText>
          }
          render={(text) => <NoWrap>{text}</NoWrap>}
          dataIndex="display"
          width={"30%"}
        />
        <Table.Column<QuotaData>
          key="key"
          title={
            <QuestionMarkText tip="Current setting or active usage.">
              Usage
            </QuestionMarkText>
          }
          dataIndex="key"
          render={(_, record) => renderUsage(record)}
          width={"45%"}
          align={"left"}
        />
        <Table.Column<QuotaData>
          key="key"
          title={renderValueColumnTitle()}
          dataIndex="limit"
          render={(_, record) => renderQuotaLimit(record)}
          width={"25%"}
          align={"right"}
        />
      </Table>
    );
  }

  return <div>{renderQuotas()}</div>;
});
