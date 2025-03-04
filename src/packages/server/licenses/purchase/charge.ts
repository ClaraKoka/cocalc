/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { getLogger } from "@cocalc/backend/logger";
import { Stripe, StripeClient } from "@cocalc/server/stripe/client";
import getConn from "@cocalc/server/stripe/connection";
import { COSTS } from "@cocalc/util/licenses/purchase/consts";
import { PurchaseInfo } from "@cocalc/util/licenses/purchase/types";
import { getDays } from "@cocalc/util/stripe/timecalcs";
import { getProductId } from "./product-id";
import { getProductMetadata } from "./product-metadata";
import { getProductName } from "./product-name";
const logger = getLogger("licenses-charge");

export type Purchase = {
  type: "invoice" | "subscription"; // what was purchased
  id: string; // the id of the *invoice* in stripe
};

export async function chargeUser(
  stripe: StripeClient,
  info: PurchaseInfo
): Promise<Purchase> {
  logger.debug("getting product_id");
  const product_id = await stripeGetProduct(info);
  if (info.type == "vouchers" || info.subscription == "no") {
    return await stripePurchaseProduct(stripe, product_id, info);
  } else {
    return await stripeCreateSubscription(stripe, product_id, info);
  }
}

export function unitAmount(info: PurchaseInfo): number {
  if (info.type == "vouchers") {
    return Math.round(info.cost * 100);
  }
  if (info.cost == null) throw Error("cost must be defined");
  return Math.round(info.cost.cost_per_unit * 100);
}

async function stripeCreatePrice(info: PurchaseInfo): Promise<void> {
  const product = getProductId(info);
  // Add the pricing info:
  //  - if sub then we set the price for monthly and yearly
  //    and build in the 25% discount since subscriptions are
  //    self-service by default.
  //  - if number of days, we set price for that many days.
  if (info.cost == null) throw Error("cost must be defined");
  const conn = await getConn();
  if (info.type == "vouchers" || info.subscription == "no") {
    // create the one-time cost
    await conn.prices.create({
      currency: "usd",
      unit_amount: unitAmount(info),
      product,
    });
  } else {
    await stripeCreatePriceSubscriptions({ product, conn, info });
  }
}

/** subscription prices:
 * - for "quota" licenses, the online discount is baked into the price.
 *   i.e. see in compute_cost(...) the discounted_cost is the total price with discounts,
 *   while all other costs don't have the online discount.
 * - dedicated resources do not have an online discount.
 */
async function stripeCreatePriceSubscriptions({
  conn,
  info,
  product,
}: {
  conn: any;
  info: PurchaseInfo;
  product: string;
}): Promise<void> {
  if (info.cost == null) throw Error("cost must be defined");
  const { type } = info;
  const common = {
    currency: "usd",
    product,
  } as const;
  if (type === "quota") {
    // create the two recurring subscription costs. Build
    // in the self-service discount, which is:
    //    COSTS.online_discount
    await conn.prices.create({
      ...common,
      unit_amount: Math.round(
        COSTS.online_discount * info.cost.cost_sub_month * 100
      ),
      recurring: { interval: "month" },
    });
    await conn.prices.create({
      ...common,
      unit_amount: Math.round(
        COSTS.online_discount * info.cost.cost_sub_year * 100
      ),
      recurring: { interval: "year" },
    });
  } else if (type === "disk" || type === "vm") {
    // there are no vm subscriptions – at this point in time – but if there are some,
    // we would handle them just like the dedicated disks
    await conn.prices.create({
      ...common,
      unit_amount: Math.round(100 * info.cost.cost_sub_month),
      recurring: { interval: "month" },
    });
    await conn.prices.create({
      ...common,
      unit_amount: Math.round(100 * info.cost.cost_sub_year),
      recurring: { interval: "year" },
    });
  }
}

async function stripeGetProduct(info: PurchaseInfo): Promise<string> {
  const product_id = getProductId(info);
  // check to see if the product has already been created; if not, create it.
  if (!(await stripeProductExists(product_id))) {
    // now we have to create the product.
    const metadata = getProductMetadata(info);
    const name = getProductName(info);
    let statement_descriptor = "COCALC ";
    if (info.type == "vouchers") {
      statement_descriptor += `${info.quantity} VOUCHER${
        info.quantity != 1 ? "S" : ""
      }`;
    } else if (info.subscription != "no") {
      statement_descriptor += "LIC SUB";
    } else {
      if (info.type === "disk") throw new Error("disk do not have a period");
      const n = getDays(info);
      statement_descriptor += `LIC ${n}${n < 100 ? " " : ""}DAYS`;
    }
    // Hard limit of 22 characters.  Deleting part of "DAYS" is ok, as
    // this is for credit card, and just having "COCALC" is mainly what is needed.
    // See https://github.com/sagemathinc/cocalc/issues/5712
    statement_descriptor = statement_descriptor.slice(0, 22);
    const conn = await getConn();
    await conn.products.create({
      id: product_id,
      name,
      metadata,
      statement_descriptor,
    });
    await stripeCreatePrice(info);
  }
  return product_id;
}

async function stripeProductExists(product_id: string): Promise<boolean> {
  try {
    const conn = await getConn();
    await conn.products.retrieve(product_id);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * rough outline, of what I think this does/should do:
 * - a product is a single purchase, e.g. license for a specific interval --
 *   there is also a subscription function, see below.
 * - A "price" is created, which is also parametrized by the number of days,
 *   but not the number of projects.
 * - This product price is without an online discount, but instead
 *   briefly a coupon is created and added to the user's account at stripe.
 * - the above is only for type==quota licenses, not VMs!
 * - The invoice is created, with the desired price, quantity, etc.
 * - When issuing the invoice to be paid, stripe calculates the discount
 *   (which introduces rounding errors between what we show the user and what happens at stripe)
 */
async function stripePurchaseProduct(
  stripe: StripeClient,
  product_id: string,
  info: PurchaseInfo
): Promise<Purchase> {
  const { quantity } = info;
  logger.debug("stripePurchaseProduct", product_id, quantity);

  if (info.type === "disk")
    throw new Error("can only deal with VMs and quota licenses");

  const customer: string = await stripe.need_customer_id();
  const conn = await getConn();

  logger.debug("stripePurchaseProduct: get price");
  const prices = await conn.prices.list({
    product: product_id,
    type: "one_time",
    active: true,
  });
  let price: string | undefined = prices.data[0]?.id;
  if (price == null) {
    logger.debug("stripePurchaseProduct: missing -- try to create it");
    await stripeCreatePrice(info);
    const prices = await conn.prices.list({
      product: product_id,
      type: "one_time",
      active: true,
    });
    price = prices.data[0]?.id;
    if (price == null) {
      logger.debug("stripePurchaseProduct: still missing -- give up");
      throw Error(
        `price for one-time purchase missing -- product_id="${product_id}"`
      );
    }
  }
  logger.debug("stripePurchaseProduct: got price", JSON.stringify(price));
  let tax_percent;
  if (info.type == "vouchers") {
    // (1) there is no period for a voucher, (2) we charge them the tax
    // amount we quoted the when creating the vouchers.
    await conn.invoiceItems.create({
      customer,
      price,
      quantity,
      metadata: info,
    });
    tax_percent = info.tax / Math.max(0.001, info.cost);
  } else {
    if (info.start == null || info.end == null) {
      throw Error("start and end must be defined");
    }
    const period = {
      start: Math.round(new Date(info.start).valueOf() / 1000),
      end: Math.round(new Date(info.end).valueOf() / 1000),
    };

    // Item gets automatically put on the invoice created below.
    await conn.invoiceItems.create({
      customer,
      price,
      quantity,
      period,
    });
    tax_percent = await stripe.sales_tax(customer);
  }

  // TODO: improve later to handle case of *multiple* items on one invoice

  // TODO: tax_percent is DEPRECATED but not gone (see stripeCreateSubscription below).

  const options = {
    customer,
    auto_advance: true,
    collection_method: "charge_automatically",
    tax_percent: tax_percent
      ? Math.round(tax_percent * 100 * 100) / 100
      : undefined,
  } as Stripe.InvoiceCreateParams;

  logger.debug("stripePurchaseProduct options=", JSON.stringify(options));

  // coupons are only for quota license upgrades, not dedicated VMs
  if (info.type === "quota") {
    logger.debug("stripePurchaseProduct -- applying coupon");
    const coupon = await getSelfServiceDiscountCoupon(conn);
    await conn.customers.update(customer, { coupon });
  }

  const invoice_id = (await conn.invoices.create(options)).id;
  logger.debug("stripePurchaseProduct -- finalizeInvoice");
  await conn.invoices.finalizeInvoice(invoice_id, {
    auto_advance: true,
  });
  logger.debug("stripePurchaseProduct -- pay invoice");
  try {
    const invoice = await conn.invoices.pay(
      invoice_id,
      info.type == "vouchers"
        ? {}
        : {
            payment_method: info.payment_method,
          }
    );
    logger.debug("stripePurchaseProduct -- paid = ", invoice.paid);
    if (info.type === "quota") {
      logger.debug("stripePurchaseProduct -- remove discount from customer");
      // remove coupon so it isn't automatically applied
      await conn.customers.deleteDiscount(customer);
    }

    if (!invoice.paid) {
      logger.debug(
        "stripePurchaseProduct -- invoice failed to be paid, so cancel"
      );
      // We void it so user doesn't get charged later.  Of course,
      // we plan to rewrite this to keep trying and once they pay it
      // somehow, then they get their license.  But that's a TODO!
      await conn.invoices.voidInvoice(invoice_id);
      throw Error(
        "created invoice but not able to pay it -- invoice has been voided; please try again when you have a valid payment method on file"
      );
    }
  } catch (err) {
    logger.debug(
      "stripePurchaseProduct -- error paying invoice, so voiding it"
    );
    await conn.invoices.voidInvoice(invoice_id);
    throw err;
  }
  logger.debug(
    "stripePurchaseProduct -- update info about user in our database"
  );
  await stripe.update_database();

  return { type: "invoice", id: invoice_id };
}

/**
 * similar to the function above, this creates a subscription.
 * - *two* prices are created, the monthly and yearly price.
 * - there is a price for each possible configuration, but not the quantity.
 * - most importantly, the online discount is baked into the price directly.
 *   i.e. no coupons.
 */
async function stripeCreateSubscription(
  stripe: StripeClient,
  product_id: string,
  info: PurchaseInfo
): Promise<Purchase> {
  if (info.type == "vouchers") {
    throw Error("stripeCreateSubscription can't be used to purchase vouchers");
  }
  const { quantity, subscription } = info;
  const customer: string = await stripe.need_customer_id();
  const conn = await getConn();

  const prices = await conn.prices.list({
    product: product_id,
    type: "recurring",
    active: true,
  });
  let price: string | undefined = undefined;
  for (const x of prices.data) {
    if (subscription.startsWith(x.recurring?.interval ?? "none")) {
      price = x?.id;
      break;
    }
  }

  if (price == null) {
    await stripeCreatePrice(info);
    const prices = await conn.prices.list({
      product: product_id,
      type: "recurring",
      active: true,
    });
    for (const x of prices.data) {
      if (subscription.startsWith(x.recurring?.interval ?? "none")) {
        price = x?.id;
        break;
      }
    }
    if (price == null) {
      logger.debug("stripePurchaseProduct: still missing -- give up");
      throw Error(
        `price for subscription purchase missing -- product_id="${product_id}", subscription="${subscription}"`
      );
    }
  }

  // TODO: will need to improve to handle case of *multiple* items on one subscription

  // CRITICAL: if we don't just multiply by 100, since then sometimes
  // stripe comes back with an error like this
  //    "Error: Invalid decimal: 8.799999999999999; must contain at maximum two decimal places."
  // TODO: tax_percent is DEPRECATED -- https://stripe.com/docs/billing/migration/taxes
  // but fortunately it still works so we can rewrite this later.
  const tax_percent = await stripe.sales_tax(customer);

  const options = {
    customer,
    // see https://github.com/sagemathinc/cocalc/issues/5234 for
    // why this payment_behavior.
    payment_behavior: "error_if_incomplete" as "error_if_incomplete",
    items: [{ price, quantity }],
    tax_percent: tax_percent
      ? Math.round(tax_percent * 100 * 100) / 100
      : undefined,
  };

  const { id } = await conn.subscriptions.create(options);
  await stripe.update_database();

  return { type: "subscription", id };
}

// Gets a coupon that matches the current online discount.
const knownCoupons: { [coupon_id: string]: boolean } = {};
async function getSelfServiceDiscountCoupon(conn: Stripe): Promise<string> {
  const percent_off = Math.round(100 * (1 - COSTS.online_discount));
  const id = `coupon_self_service_${percent_off}`;
  if (knownCoupons[id]) {
    return id;
  }
  try {
    await conn.coupons.retrieve(id);
  } catch (_) {
    // coupon doesn't exist, so we have to create it.
    await conn.coupons.create({
      id,
      percent_off,
      name: "Self-service discount",
      duration: "forever",
    });
  }
  knownCoupons[id] = true;
  return id;
}

export async function setPurchaseMetadata(
  purchase: Purchase,
  metadata
): Promise<void> {
  const conn = await getConn();
  switch (purchase.type) {
    case "subscription":
      await conn.subscriptions.update(purchase.id, { metadata });
      break;
    case "invoice":
      await conn.invoices.update(purchase.id, { metadata });
      break;
    default:
      throw new Error(`unexpected purchase type ${purchase.type}`);
  }
}
