/*
 *  This file is part of CoCalc: Copyright © 2022 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

/*
Shopping cart.

The UX is similar to Amazon.com, since that's probably the single most popular
shopping cart experience, so most likely to feel familiar to users and easy
to use.
*/

import { Icon } from "@cocalc/frontend/components/icon";
import { describeQuotaFromInfo } from "@cocalc/util/licenses/describe-quota";
import { CostInputPeriod } from "@cocalc/util/licenses/purchase/types";
import { money } from "@cocalc/util/licenses/purchase/utils";
import { capitalize, isValidUUID, plural } from "@cocalc/util/misc";
import { Alert, Button, Checkbox, Popconfirm, Table } from "antd";
import A from "components/misc/A";
import Loading from "components/share/loading";
import SiteName from "components/share/site-name";
import apiPost from "lib/api/post";
import useAPI from "lib/hooks/api";
import useIsMounted from "lib/hooks/mounted";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { computeCost } from "@cocalc/util/licenses/store/compute-cost";
import OtherItems from "./other-items";
import { EditRunLimit } from "./run-limit";
import { describeItem, describePeriod, DisplayCost } from "./site-license-cost";

export default function ShoppingCart() {
  const isMounted = useIsMounted();
  const [updating, setUpdating] = useState<boolean>(false);
  const [subTotal, setSubTotal] = useState<number>(0);
  const router = useRouter();

  // most likely, user will checkout next
  useEffect(() => {
    router.prefetch("/store/checkout");
  }, []);

  const cart = useAPI("/shopping/cart/get");

  const items = useMemo(() => {
    if (!cart.result) return undefined;
    // TODO deal with errors returned by useAPI
    if (cart.result.error != null) return undefined;
    const x: any[] = [];
    let subTotal = 0;
    for (const item of cart.result) {
      try {
        item.cost = computeCost(item.description);
      } catch (err) {
        // sadly computeCost is buggy, or rather - it crashes because of other bugs.
        // It's much better to
        // have something not in the cart and an error than to make the cart and
        // store just be 100% broken
        // forever for a user!
        // That said, I've fixed every bug I could find and tested things, so hopefully
        // this doesn't come up.
        console.warn("Invalid item in cart -- not showing", item);
        continue;
      }
      if (item.checked) {
        subTotal += item.cost.discounted_cost;
      }
      x.push(item);
    }
    setSubTotal(subTotal);
    return x;
  }, [cart.result]);

  if (cart.error) {
    return <Alert type="error" message={cart.error} />;
  }

  if (!items) {
    return <Loading center />;
  }

  async function reload() {
    if (!isMounted.current) return;
    setUpdating(true);
    try {
      await cart.call();
    } finally {
      if (isMounted.current) {
        setUpdating(false);
      }
    }
  }

  const columns = [
    {
      responsive: ["xs" as "xs"],
      render: ({ id, checked, cost, description, type, project_id }) => {
        return (
          <div>
            <CheckboxColumn
              {...{ id, checked, updating, setUpdating, isMounted, reload }}
            />
            <DescriptionColumn
              {...{
                id,
                cost,
                description,
                updating,
                setUpdating,
                isMounted,
                reload,
                type,
                project_id,
              }}
              compact
            />
            <div>
              <b style={{ fontSize: "11pt" }}>
                <DisplayCost cost={cost} simple oneLine />
              </b>
            </div>
          </div>
        );
      },
    },
    {
      responsive: ["sm" as "sm"],
      title: "",
      render: (_, { id, checked }) => (
        <CheckboxColumn
          {...{ id, checked, updating, setUpdating, isMounted, reload }}
        />
      ),
    },
    {
      responsive: ["sm" as "sm"],
      title: "Product",
      align: "center" as "center",
      render: () => (
        <div style={{ color: "darkblue" }}>
          <Icon name="key" style={{ fontSize: "24px" }} />
          <div style={{ fontSize: "10pt" }}>Site License</div>
        </div>
      ),
    },
    {
      responsive: ["sm" as "sm"],
      width: "60%",
      render: (_, { id, cost, description, type, project_id }) => (
        <DescriptionColumn
          {...{
            id,
            cost,
            description,
            updating,
            setUpdating,
            isMounted,
            reload,
            type,
            project_id,
          }}
          compact={false}
        />
      ),
    },
    {
      responsive: ["sm" as "sm"],
      title: "Price",
      align: "right" as "right",
      render: (_, { cost }) => (
        <b style={{ fontSize: "11pt" }}>
          <DisplayCost cost={cost} simple />
        </b>
      ),
    },
  ];

  function noItems() {
    return (
      <>
        <h3>
          <Icon name={"shopping-cart"} style={{ marginRight: "5px" }} /> Your{" "}
          <SiteName /> Shopping Cart is Empty
        </h3>
        <A href="/store/site-license">Buy a License</A>
      </>
    );
  }

  function Proceed() {
    const checkout = (
      <Button
        disabled={subTotal == 0 || updating}
        size="large"
        type="primary"
        onClick={() => {
          router.push("/store/checkout");
        }}
      >
        Proceed to Checkout
      </Button>
    );
    return (
      <div>
        <Button.Group>
          {checkout}
          <Button
            disabled={subTotal == 0 || updating}
            size="large"
            onClick={() => {
              router.push("/store/vouchers");
            }}
          >
            Create Vouchers
          </Button>
        </Button.Group>
      </div>
    );
  }

  function renderItems() {
    return (
      <>
        <div style={{ float: "right" }}>
          <span style={{ fontSize: "13pt", marginRight: "15px" }}>
            <TotalCost items={items} />
          </span>
          <Proceed />
        </div>
        <h3>
          <Icon name={"shopping-cart"} style={{ marginRight: "5px" }} />{" "}
          Shopping Cart
        </h3>
        <div style={{ marginTop: "-10px" }}>
          <SelectAllItems items={items} onChange={reload} />
          <Button
            type="link"
            style={{ marginLeft: "15px" }}
            onClick={() => router.push("/store/site-license")}
          >
            Continue Shopping
          </Button>
        </div>
        <div style={{ border: "1px solid #eee", marginTop: "15px" }}>
          <Table
            showHeader={false}
            columns={columns}
            dataSource={items}
            rowKey={"id"}
            pagination={{ hideOnSinglePage: true }}
          />
        </div>
        <div
          style={{
            float: "right",
            fontSize: "12pt",
            margin: "15px 15px 0 0",
          }}
        >
          <div style={{ float: "right" }}>
            <TotalCost items={cart.result} />
          </div>
          <br />
        </div>
      </>
    );
  }

  return (
    <>
      {items.length == 0 && noItems()}
      {items.length > 0 && renderItems()}

      <div
        style={{
          marginTop: "60px",
          border: "1px solid #eee",
        }}
      >
        <OtherItems onChange={reload} cart={cart} />
      </div>
    </>
  );
}

function TotalCost({ items }) {
  let discounted_cost = 0;
  let n = 0;
  for (const { cost, checked } of items) {
    if (checked && cost != null) {
      discounted_cost += cost.discounted_cost;
      n += 1;
    }
  }
  if (n == 0) {
    return <>No items selected</>;
  }
  return (
    <>
      Subtotal ({n} items): <b>{money(discounted_cost)}</b>
    </>
  );
}

function SelectAllItems({ items, onChange }) {
  const numSelected = useMemo(() => {
    let n = 0;
    if (items == null) return n;
    for (const item of items) {
      if (item.checked) n += 1;
    }
    return n;
  }, [items]);
  if (items == null) return null;

  async function doSelectAll(checked: boolean) {
    await apiPost("/shopping/cart/checked", { checked });
    onChange();
  }

  if (numSelected == 0) {
    return (
      <>
        <Button type="primary" onClick={() => doSelectAll(true)}>
          Select all items
        </Button>
      </>
    );
  }
  if (numSelected < items.length) {
    return (
      <Button type="link" onClick={() => doSelectAll(true)}>
        Select all items
      </Button>
    );
  }
  return (
    <Button type="link" onClick={() => doSelectAll(false)}>
      Deselect all items
    </Button>
  );
}

function CheckboxColumn({
  id,
  checked,
  updating,
  setUpdating,
  isMounted,
  reload,
}) {
  return (
    <Checkbox
      disabled={updating}
      checked={checked}
      onChange={async (e) => {
        setUpdating(true);
        try {
          await apiPost("/shopping/cart/checked", {
            id,
            checked: e.target.checked,
          });
          if (!isMounted.current) return;
          await reload();
        } finally {
          if (!isMounted.current) return;
          setUpdating(false);
        }
      }}
    >
      <span className="sr-only">Select</span>
    </Checkbox>
  );
}

interface DCProps {
  id: string;
  cost: CostInputPeriod;
  description;
  updating: boolean;
  setUpdating: (u: boolean) => void;
  isMounted: { current: boolean };
  reload: () => void;
  compact: boolean;
  project_id?: string;
}

function DescriptionColumn(props: DCProps) {
  const {
    id,
    cost,
    description,
    updating,
    setUpdating,
    isMounted,
    reload,
    compact,
    project_id,
  } = props;
  const router = useRouter();
  const { input } = cost;
  const [editRunLimit, setEditRunLimit] = useState<boolean>(false);
  const [runLimit, setRunLimit] = useState<number>(description.run_limit);

  const showRunLimitEditor =
    description.type !== "disk" && description.type !== "vm";

  function renderEditRunLimit(): JSX.Element | null {
    if (!editRunLimit) return null;
    return (
      <div
        style={{
          border: "1px solid #eee",
          padding: "15px",
          margin: "15px 0",
          background: "white",
        }}
      >
        <Icon
          name="times"
          style={{ float: "right" }}
          onClick={() => {
            setEditRunLimit(false);
          }}
        />
        <EditRunLimit value={runLimit} onChange={setRunLimit} />
        <Button
          type="primary"
          style={{ marginTop: "15px" }}
          onClick={async () => {
            setEditRunLimit(false);
            await apiPost("/shopping/cart/edit", {
              id,
              description: { ...description, run_limit: runLimit },
            });
            await reload();
          }}
        >
          Save
        </Button>
      </div>
    );
  }

  function renderProjectID(): JSX.Element | null {
    if (!project_id || !isValidUUID(project_id)) return null;
    return (
      <Alert
        type="info"
        banner={true}
        message={
          <>
            For project: <code>{project_id}</code>
          </>
        }
      />
    );
  }

  function editableQuota() {
    return (
      <div>
        <div>
          {describeQuotaFromInfo(input)}
          {showRunLimitEditor && !editRunLimit && (
            <>
              <br />
              <Button
                onClick={() => setEditRunLimit(true)}
                disabled={updating}
                style={{ marginBottom: "5px" }}
              >
                {runLimit} simultaneous running {plural(runLimit, "project")}
              </Button>
            </>
          )}
        </div>
        {renderEditRunLimit()}
        {renderProjectID()}
      </div>
    );
  }

  // this could rely an the "type" field, but we rather check the data directly
  function editPage(): "site-license" | "boost" | "dedicated" {
    if (input.type === "disk" || input.type === "vm") {
      return "dedicated";
    } else if (input.boost) {
      return "boost";
    }
    return "site-license";
  }

  return (
    <div style={{ fontSize: "12pt" }}>
      {description.title && (
        <div>
          <b>{description.title}</b>
        </div>
      )}
      {description.description && <div>{description.description}</div>}
      <div>
        <b>
          {input.subscription == "no"
            ? describePeriod({ quota: input })
            : capitalize(input.subscription) + " subscription"}
        </b>
      </div>
      <div
        style={{
          border: "1px solid lightblue",
          background: "white",
          padding: "15px 15px 5px 15px",
          margin: "5px 0 10px 0",
          borderRadius: "5px",
        }}
      >
        {compact ? describeItem({ info: input }) : editableQuota()}{" "}
      </div>
      <Button
        style={{ marginRight: "5px" }}
        onClick={() => {
          const page = editPage();
          router.push(`/store/${page}?id=${id}`);
        }}
      >
        <Icon name="pencil" /> Edit
      </Button>
      <Button
        style={{ margin: "0 5px 5px 0" }}
        disabled={updating}
        onClick={async () => {
          setUpdating(true);
          try {
            await apiPost("/shopping/cart/remove", { id });
            if (!isMounted.current) return;
            await reload();
          } finally {
            if (!isMounted.current) return;
            setUpdating(false);
          }
        }}
      >
        <Icon name="save" /> Save for later
      </Button>
      <Popconfirm
        title={"Are you sure you want to delete this item?"}
        onConfirm={async () => {
          setUpdating(true);
          try {
            await apiPost("/shopping/cart/delete", { id });
            if (!isMounted.current) return;
            await reload();
          } finally {
            if (!isMounted.current) return;
            setUpdating(false);
          }
        }}
        okText={"Yes, delete this item"}
        cancelText={"Cancel"}
      >
        <Button disabled={updating} type="dashed">
          <Icon name="trash" /> Delete
        </Button>
      </Popconfirm>
    </div>
  );
}
