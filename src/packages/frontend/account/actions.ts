/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: AGPLv3 s.t. "Commons Clause" – see LICENSE.md for details
 */

import { fromJS } from "immutable";
import { join } from "path";

import { alert_message } from "@cocalc/frontend/alerts";
import { Actions } from "@cocalc/frontend/app-framework/Actions";
import { AccountClient } from "@cocalc/frontend/client/account";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { set_url } from "@cocalc/frontend/history";
import { track_conversion } from "@cocalc/frontend/misc";
import { deleteRememberMe } from "@cocalc/frontend/misc/remember-me";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { define, required } from "@cocalc/util/fill";
import { encode_path } from "@cocalc/util/misc";
import { show_announce_end, show_announce_start } from "./dates";
import { AccountState } from "./types";
import { AccountStore } from "./store";
import track from "@cocalc/frontend/user-tracking";

// Define account actions
export class AccountActions extends Actions<AccountState> {
  private _last_history_state: string;
  private account_client: AccountClient = webapp_client.account_client;

  _init(store): void {
    store.on("change", this.derive_show_global_info);
    store.on("change", this.update_unread_news);
  }

  private help(): string {
    return this.redux.getStore("customize").get("help_email");
  }

  derive_show_global_info(store: AccountStore): void {
    // TODO when there is more time, rewrite this to be tied to announcements of a specific type (and use their timestamps)
    // for now, we use the existence of a timestamp value to indicate that the banner is not shown
    let show_global_info;
    const sgi2 = store.getIn(["other_settings", "show_global_info2"]);
    // unknown state, right after opening the application
    if (sgi2 === "loading") {
      show_global_info = false;
      // value not set means there is no timestamp → show banner
    } else {
      // ... if it is inside the scheduling window
      let middle;
      const start = show_announce_start;
      const end = show_announce_end;
      const in_window =
        start < (middle = webapp_client.time_client.server_time()) &&
        middle < end;

      if (sgi2 == null) {
        show_global_info = in_window;
        // 3rd case: a timestamp is set
        // show the banner only if its start_dt timetstamp is earlier than now
        // *and* when the last "dismiss time" by the user is prior to it.
      } else {
        const sgi2_dt = new Date(sgi2);
        const dismissed_before_start = sgi2_dt < start;
        show_global_info = in_window && dismissed_before_start;
      }
    }
    this.setState({ show_global_info });
  }

  update_unread_news(store: AccountStore): void {
    const news_read_until = store.getIn(["other_settings", "news_read_until"]);
    const news_actions = this.redux.getActions("news");
    news_actions?.updateUnreadCount(news_read_until);
  }

  set_user_type(user_type): void {
    this.setState({
      user_type,
      is_logged_in: user_type === "signed_in",
    });
  }

  public async sign_in(email: string, password: string): Promise<void> {
    const doc_conn =
      "[connectivity debugging tips](https://doc.cocalc.com/howto/connectivity-issues.html)";
    const err_help = `\
Please try again.

If that doesn't work after a few minutes, try these ${doc_conn} or email ${this.help()}.\
`;

    this.setState({ signing_in: true });
    let mesg;
    try {
      mesg = await this.account_client.sign_in({
        email_address: email,
        password,
        remember_me: true,
        get_api_key: !!this.redux.getStore("page").get("get_api_key"),
      });
    } catch (err) {
      this.setState({
        sign_in_error: `There was an error signing you in -- (${err.message}). ${err_help}`,
      });
      return;
    }
    this.setState({ signing_in: false });
    switch (mesg.event) {
      case "sign_in_failed":
        this.setState({ sign_in_error: mesg.reason });
        return;
      case "signed_in":
        break;
      case "error":
        this.setState({ sign_in_error: mesg.reason });
        return;
      default:
        // should never ever happen
        this.setState({
          sign_in_error: `The server responded with invalid message when signing in: ${JSON.stringify(
            mesg
          )}`,
        });
        return;
    }
  }

  public async create_account(
    first_name: string,
    last_name: string,
    email_address: string,
    password: string,
    token?: string,
    usage_intent?: string
  ): Promise<void> {
    this.setState({ signing_up: true });
    let mesg;
    try {
      mesg = await this.account_client.create_account({
        first_name,
        last_name,
        email_address,
        password,
        usage_intent,
        agreed_to_terms: true, // since never gets called if not set in UI
        token,
        get_api_key: !!this.redux.getStore("page").get("get_api_key"),
      });
    } catch (err) {
      // generic error.
      this.setState(
        fromJS({ sign_up_error: { generic: JSON.stringify(err) } })
      );
      return;
    } finally {
      this.setState({ signing_up: false });
    }
    switch (mesg.event) {
      case "account_creation_failed":
        this.setState({ sign_up_error: mesg.reason });
        return;
      case "signed_in":
        this.redux.getActions("page").set_active_tab("projects");
        track_conversion("create_account");
        return;
      default:
        // should never ever happen
        alert_message({
          type: "error",
          message: `The server responded with invalid message to account creation request: #{JSON.stringify(mesg)}`,
        });
    }
  }

  // deletes the account and then signs out everywhere
  public async delete_account(): Promise<void> {
    // cancel any subscriptions
    try {
      await this.redux.getActions("billing").cancel_everything();
    } catch (err) {
      if (this.redux.getStore("billing").get("no_stripe")) {
        // stripe not configured on backend, so this err is expected
      } else {
        throw err;
      }
    }

    try {
      // actually request to delete the account
      await this.account_client.delete_account(
        this.redux.getStore("account").get_account_id()
      );
    } catch (err) {
      this.setState({
        account_deletion_error: `Error trying to delete the account: ${err.message}`,
      });
      return;
    }
    this.sign_out(true);
  }

  public async forgot_password(email_address: string): Promise<void> {
    try {
      await this.account_client.forgot_password(email_address);
    } catch (err) {
      this.setState({
        forgot_password_error: `Error sending password reset message to ${email_address} -- ${err}. Write to ${this.help()} for help.`,
        forgot_password_success: "",
      });
      return;
    }
    this.setState({
      forgot_password_success: `Password reset message sent to ${email_address}; if you don't receive it, check your spam folder; if you have further trouble, write to ${this.help()}.`,
      forgot_password_error: "",
    });
  }

  public async reset_password(
    reset_code: string,
    new_password: string
  ): Promise<void> {
    try {
      await this.account_client.reset_forgot_password(reset_code, new_password);
    } catch (err) {
      this.setState({
        reset_password_error: err.message,
      });
      return;
    }
    // success
    // TODO: can we automatically log them in?  Should we?  Seems dangerous.
    history.pushState({}, "", location.href);
    this.setState({ reset_key: "", reset_password_error: "" });
  }

  public async sign_out(
    everywhere: boolean,
    sign_in: boolean = false
  ): Promise<void> {
    // disable redirection from sign in/up...
    deleteRememberMe(appBasePath);

    // Send a message to the server that the user explicitly
    // requested to sign out.  The server must clean up resources
    // and *invalidate* the remember_me cookie for this client.
    try {
      await this.account_client.sign_out(everywhere);
    } catch (error) {
      // The state when this happens could be
      // arbitrarily messed up.  So... both pop up an error (which user will see),
      // and set something in the store, which may or may not get displayed.
      const err = `Error signing you out -- ${error}.  Please refresh your browser and try again.`;
      alert_message({ type: "error", message: err });
      this.setState({
        sign_out_error: err,
        show_sign_out: false,
      });
      return;
    }
    // Invalidate the remember_me cookie and force a refresh, since otherwise there could be data
    // left in the DOM, which could lead to a vulnerability
    // or bleed into the next login somehow.
    $(window).off("beforeunload", this.redux.getActions("page").check_unload);
    // redirect to sign in page if sign_in is true; otherwise, the landing page:
    window.location.href = join(appBasePath, sign_in ? "auth/sign-in" : "/");
  }

  push_state(url?: string): void {
    if (url == null) {
      url = this._last_history_state;
    }
    if (url == null) {
      url = "";
    }
    this._last_history_state = url;
    set_url("/settings" + encode_path(url));
  }

  public set_active_tab(tab: string): void {
    track("settings", { tab });
    this.setState({ active_page: tab });
    this.push_state("/" + tab);
  }

  // Add an ssh key for this user, with the given fingerprint, title, and value
  public add_ssh_key(unsafe_opts: unknown): void {
    const opts = define<{
      fingerprint: string;
      title: string;
      value: string;
    }>(unsafe_opts, {
      fingerprint: required,
      title: required,
      value: required,
    });
    this.redux.getTable("account").set({
      ssh_keys: {
        [opts.fingerprint]: {
          title: opts.title,
          value: opts.value,
          creation_date: new Date().valueOf(),
        },
      },
    });
  }

  // Delete the ssh key with given fingerprint for this user.
  public delete_ssh_key(fingerprint): void {
    this.redux.getTable("account").set({
      ssh_keys: {
        [fingerprint]: null,
      },
    }); // null is how to tell the backend/synctable to delete this...
  }

  public set_account_table(obj: object): void {
    this.redux.getTable("account").set(obj);
  }

  public set_other_settings(name: string, value: any): void {
    this.set_account_table({ other_settings: { [name]: value } });
  }

  public set_show_purchase_form(show: boolean) {
    // this controlls the default state of the "buy a license" purchase form in account → licenses
    // by default, it's not showing up
    this.setState({ show_purchase_form: show });
  }

  setTourDone(tour: string) {
    const table = this.redux.getTable("account");
    if (!table) return;
    const store = this.redux.getStore("account");
    if (!store) return;
    const tours: string[] = store.get("tours")?.toJS() ?? [];
    if (!tours?.includes(tour)) {
      tours.push(tour);
      table.set({ tours });
    }
  }
  setTourNotDone(tour: string) {
    const table = this.redux.getTable("account");
    if (!table) return;
    const store = this.redux.getStore("account");
    if (!store) return;
    const tours: string[] = store.get("tours")?.toJS() ?? [];
    if (tours?.includes(tour)) {
      table.set({ tours: tours.map((x) => x != tour) });
    }
  }
}
