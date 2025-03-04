/*
 *  This file is part of CoCalc: Copyright © 2021 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { Alert, Button, Popconfirm, Table } from "antd";
import { useState } from "react";

import { Icon } from "@cocalc/frontend/components/icon";
import { capitalize, cmp, planInterval, stripeAmount } from "@cocalc/util/misc";
import License from "components/licenses/license";
import { CSS, Paragraph, Text, Title } from "components/misc";
import A from "components/misc/A";
import HelpEmail from "components/misc/help-email";
import Timestamp from "components/misc/timestamp";
import Loading from "components/share/loading";
import apiPost from "lib/api/post";
import useAPI from "lib/hooks/api";
import useIsMounted from "lib/hooks/mounted";
import { Details as LicenseLoader } from "../licenses/license";
import { InvoicesData } from "@cocalc/util/types/stripe";

const DESCR_STYLE: CSS = {
  wordWrap: "break-word",
  wordBreak: "break-word",
} as const;

function getInvoiceById(invoices, id) {
  for (const invoice of invoices.data ?? []) {
    if (invoice.id == id) return invoice;
  }
  return null;
}

interface DescriptionProps {
  latest_invoice: string;
  metadata?: { license_id: string };
  invoices: InvoicesData;
}

function Description(props: DescriptionProps) {
  const { latest_invoice, metadata, invoices } = props;

  const invoice = getInvoiceById(invoices, latest_invoice);

  if (invoice?.lines != null) {
    const cnt = invoice.lines.total_count ?? 1;
    const url = invoice.hosted_invoice_url;
    return (
      <div style={DESCR_STYLE}>
        {invoice.lines.data[0].description}
        {cnt > 1 && ", etc."}
        {url && (
          <div>
            <A href={url}>
              <Icon name="external-link" /> Invoice
            </A>
          </div>
        )}
        {metadata?.license_id && (
          <div>
            License: <License license_id={metadata?.license_id} />
          </div>
        )}
      </div>
    );
  }

  // in case the above didn't return, i.e. invoice was not found in the invoices.data array, we try to load it:
  if (metadata?.license_id) {
    return (
      <div style={DESCR_STYLE}>
        <LicenseLoader license_id={metadata.license_id} condensed={true} />
        License: <License license_id={metadata.license_id} />
      </div>
    );
  }
  return null;
}

function Period({
  current_period_start,
  current_period_end,
  cancel_at_period_end,
}) {
  return (
    <>
      <Timestamp epoch={1000 * current_period_start} dateOnly absolute /> –{" "}
      <Timestamp epoch={1000 * current_period_end} dateOnly absolute />
      {cancel_at_period_end && (
        <span>
          <br />
          (will cancel at period end)
        </span>
      )}
    </>
  );
}

function Status({ status }) {
  return <>{capitalize(status)}</>;
}

interface CostProps {
  latest_invoice: string;
  plan: {
    amount: number;
    currency: string;
    interval: string;
    interval_count: number;
  };
  invoices: InvoicesData;
  metadata?: { license_id: string };
}

function Cost({ latest_invoice, plan, invoices, metadata }: CostProps) {
  const invoice = getInvoiceById(invoices, latest_invoice);
  if (invoice != null) {
    const unitCount = invoice.lines?.data?.[0].quantity ?? 1;
    return (
      <>
        {stripeAmount(plan.amount, plan.currency, unitCount)} for{" "}
        {planInterval(plan.interval, plan.interval_count)}
      </>
    );
    // since no invoice has been not found in the invoices.data array, we try to load it:
  } else if (metadata?.license_id) {
    return (
      <LicenseLoader
        license_id={metadata.license_id}
        type={"cost"}
        plan={plan}
      />
    );
  }
  return <Text type="secondary">no data available</Text>;
}

interface CancelProps {
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  id: string;
  onChange: () => void;
}

function Cancel(props: CancelProps) {
  const { cancel_at_period_end, cancel_at, id, onChange } = props;
  const [error, setError] = useState<string>("");
  const [canceling, setCanceling] = useState<boolean>(false);
  const isMounted = useIsMounted();
  const isCanceled = cancel_at_period_end || cancel_at != null;
  return (
    <div>
      <Popconfirm
        placement="bottomLeft"
        title={
          <div style={{ maxWidth: "500px" }}>
            Cancel? Are you sure you want to{" "}
            <b>cancel this subscription at period end</b>? If you cancel your
            subscription, it will run to the end of the subscription period, but
            will not be renewed when the current (already paid for) period ends.
            If you need further clarification or need a refund,{" "}
            <HelpEmail lower />.
          </div>
        }
        onConfirm={async () => {
          setCanceling(true);
          setError("");
          try {
            await apiPost("billing/cancel-subscription", { id });
          } catch (err) {
            if (!isMounted.current) return;
            setError(err.message);
          } finally {
            if (!isMounted.current) return;
            setCanceling(false);
            onChange();
          }
        }}
        okText="Yes, cancel at period end (do not auto-renew)"
        cancelText="Make no change"
      >
        <Button disabled={isCanceled || canceling} type="dashed">
          {canceling ? (
            <Loading delay={0}>Canceling...</Loading>
          ) : (
            `Cancel${isCanceled ? "led" : ""}`
          )}
        </Button>
        {error && (
          <Alert
            style={{ marginTop: "15px" }}
            type="error"
            message={`Error: ${error}`}
          />
        )}
      </Popconfirm>
    </div>
  );
}

function columns(invoices, onChange) {
  return [
    {
      responsive: ["xs"],
      title: "Subscriptions",
      render: (_, sub) => (
        <div>
          <Description {...sub} invoices={invoices} />
          Status: <Status {...sub} />
          <br />
          Period: <Period {...sub} />
          <br />
          Cost: <Cost {...sub} invoices={invoices} />
          <br />
          <Cancel {...sub} onChange={onChange} />
        </div>
      ),
    },
    {
      responsive: ["sm"],
      title: "Description",
      width: "50%",
      render: (_, sub) => <Description {...sub} invoices={invoices} />,
    },
    {
      responsive: ["sm"],
      title: "Status",
      align: "center" as "center",
      render: (_, sub) => <Status {...sub} />,
      sorter: { compare: (a, b) => cmp(a.status, b.status) },
    },
    {
      responsive: ["sm"],
      title: "Period",
      align: "center" as "center",
      render: (_, sub) => <Period {...sub} />,
    },
    {
      responsive: ["sm"],
      title: "Cost",
      sorter: { compare: (a, b) => cmp(a.plan.amount, b.plan.amount) },
      render: (_, sub) => <Cost {...sub} invoices={invoices} />,
    },
    {
      responsive: ["sm"],
      title: "Cancel",
      align: "center" as "center",
      render: (_, sub) => <Cancel {...sub} onChange={onChange} />,
    },
  ];
}

export default function Subscriptions() {
  const subscriptions = useAPI("billing/get-subscriptions", { limit: 100 });
  const invoices = useAPI("billing/get-invoices-and-receipts");
  if (subscriptions.error) {
    return <Alert type="error" message={subscriptions.error} />;
  }
  if (!subscriptions.result) {
    return <Loading />;
  }
  if (invoices.error) {
    return <Alert type="error" message={invoices.error} />;
  }
  if (!invoices.result) {
    return <Loading />;
  }

  function onChange() {
    subscriptions.call();
    invoices.call();
  }

  return (
    <div>
      <Title level={2}>
        Your Subscriptions ({subscriptions.result?.data?.length ?? 0})
      </Title>
      <Paragraph style={{ marginBottom: "30px" }}>
        Your subscriptions are listed below. You can view invoices, get
        information about the license or plan corresponding to a subscription,
        and cancel a subscription at period end. You can also{" "}
        <A href="/store/site-license">create a new site license subscription</A>
        . If you have any questions <HelpEmail lower />.
      </Paragraph>
      <Table
        columns={columns(invoices.result, onChange) as any}
        dataSource={subscriptions.result?.data ?? []}
        rowKey={"id"}
        pagination={{ hideOnSinglePage: true, pageSize: 100 }}
        style={{ overflowX: "auto" }}
      />
      {subscriptions.result?.has_more && (
        <Alert
          style={{ margin: "15px" }}
          type="warning"
          showIcon
          message="WARNING: Some of your subscriptions are not displayed above, since there are so many."
        />
      )}
    </div>
  );
}
