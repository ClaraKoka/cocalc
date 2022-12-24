import { useState } from "react";
import { render } from "./register";
import { Avatar } from "@cocalc/frontend/account/avatar/avatar";
import {
  Alert,
  Button,
  Input,
  List,
  Popconfirm,
  Select,
  SelectProps,
  Space,
} from "antd";
import {
  user_search,
  User,
} from "@cocalc/frontend/frame-editors/generic/client";
import { useEditableContext } from "./context";
import useAccountName from "@cocalc/frontend/users/use-account-name";
import { CloseOutlined } from "@ant-design/icons";
import { TimeAgo } from "@cocalc/frontend/components";

const AVATAR_SIZE = 18;

render({ type: "accounts" }, ({ field, obj, spec, viewOnly }) => {
  if (spec.type != "accounts") throw Error("bug");
  const account_ids = obj[field];
  if (!account_ids && viewOnly) return null;
  if (!viewOnly && spec.editable) {
    return (
      <EditAccounts obj={obj} field={field} account_ids={account_ids ?? []} />
    );
  } else {
    return (
      <div>
        {(account_ids ?? []).map((account_id) => (
          <Avatar key={account_id} account_id={account_id} size={AVATAR_SIZE} />
        ))}
      </div>
    );
  }
});

render({ type: "account" }, ({ field, obj }) => {
  const account_id = obj[field];
  if (!account_id) return null;
  return <Avatar key={account_id} account_id={account_id} size={AVATAR_SIZE} />;
});

function EditAccounts({ obj, field, account_ids }) {
  const { error: saveError, save: save0 } = useEditableContext<string[]>(field);
  const save = (value: string[]) => save0(obj, value);
  return (
    <div>
      <AccountList account_ids={account_ids ?? []} save={save} />
      {saveError && <Alert message={saveError} type="error" />}
      <AddAccount
        key="add-account"
        account_ids={account_ids ?? []}
        save={save}
      />
    </div>
  );
}

function AccountList({
  account_ids,
  save,
}: {
  account_ids: string[];
  save: (account_ids: string[]) => Promise<void>;
}) {
  return (
    <List
      itemLayout="horizontal"
      dataSource={account_ids}
      renderItem={(account_id: string) => (
        <List.Item>
          <Space>
            <Avatar key={account_id} account_id={account_id} />
            <AccountName account_id={account_id} />
          </Space>
          <Popconfirm
            title="Remove this account?"
            onConfirm={() => {
              save(account_ids.filter((x) => x != account_id));
            }}
          >
            <Button type="link">
              <CloseOutlined />
            </Button>
          </Popconfirm>
        </List.Item>
      )}
    />
  );
}

function AccountName({ account_id }) {
  const name = useAccountName(account_id);
  if (name == null) return null;
  return (
    <>
      {name.firstName} {name.lastName}
    </>
  );
}

function AddAccount({
  account_ids,
  save,
}: {
  account_ids: string[];
  save: (account_ids: string[]) => Promise<void>;
}) {
  const [error, setError] = useState<string>("");
  const [users, setUsers] = useState<User[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  return (
    <div>
      {(users == null || users.length == 0) && !error && (
        <Input.Search
          allowClear
          loading={loading}
          placeholder="Search accounts by first name, last name, or email address..."
          enterButton
          onSearch={async (value) => {
            setError("");
            setUsers(null);
            if (!value) {
              return;
            }
            setLoading(true);
            try {
              let users = await user_search({
                query: value.toLowerCase(), // backend assumes lower case
                admin: true,
                limit: 100,
              });
              // exclude any we have already
              if (account_ids.length > 0) {
                const x = new Set(account_ids);
                users = users.filter((user) => !x.has(user.account_id));
              }
              setUsers(users);
            } catch (err) {
              setError(`${err}`);
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
      {error && <Alert message={error} type="error" />}
      {users != null && (
        <Users
          users={users}
          addAccounts={(new_account_ids: string[]) => {
            setError("");
            setUsers(null);
            if (new_account_ids.length > 0) {
              save(account_ids.concat(new_account_ids));
            }
          }}
        />
      )}
    </div>
  );
}

function Users({
  users,
  addAccounts,
}: {
  users: User[];
  addAccounts: (account_ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  if (users.length == 0) {
    return <div>No results</div>;
  }

  const options: SelectProps["options"] = [];
  for (const user of users) {
    options.push({
      label: (
        <div>
          <Avatar account_id={user.account_id} size={AVATAR_SIZE} />{" "}
          {user.first_name} {user.last_name} -- {user.email_address},{" "}
          {user.last_active ? (
            <>
              active <TimeAgo date={user.last_active} />
            </>
          ) : (
            "never active"
          )}
          , created <TimeAgo date={user.created} />
        </div>
      ),
      value: user.account_id,
    });
  }
  return (
    <div>
      <Space style={{ marginBottom: "5px" }}>
        <Button
          disabled={selected.length == 0}
          type="primary"
          onClick={() => {
            addAccounts(selected);
          }}
        >
          Add Selected
        </Button>
        <Button
          onClick={() => {
            addAccounts([]);
          }}
        >
          Cancel
        </Button>
      </Space>
      <Select
        open
        autoFocus
        mode="multiple"
        allowClear
        style={{ width: "100%" }}
        placeholder="Please select accounts to associate with this person"
        defaultValue={[]}
        onChange={setSelected}
        options={options}
      />
    </div>
  );
}
