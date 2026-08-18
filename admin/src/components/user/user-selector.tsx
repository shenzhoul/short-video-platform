'use client';

import { appMessage as message } from '@lib/antd-message';
import { userService } from '@services/user.service';
import { Avatar, Select } from 'antd';
import { debounce } from 'lodash';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

interface IProps {
  onSelect?: (val: string) => void;
  value?: string;
  onChange?: (val: string | undefined) => void;

  defaultValue?: string;
  disabled?: boolean;
  noEmpty?: boolean;
  placeholder?: string;
}

export function UserSelector({
  onSelect = () => { },
  value = undefined,
  onChange = () => { },
  defaultValue = undefined,
  disabled = false,
  noEmpty = false,
  placeholder = 'Search and select a user'
}: IProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [selectedValue, setSelectedValue] = useState<string | undefined>(defaultValue);
  const selectRef = useRef(null);

  const currentValue = useMemo(
    () => (value !== undefined ? value : selectedValue),
    [value, selectedValue]
  );

  const syncSelectedValue = useEffectEvent(() => {
    if (defaultValue !== undefined) setSelectedValue(defaultValue);
  });

  useEffect(() => {
    syncSelectedValue();
  }, [defaultValue]);

  const searchUsers = useMemo(
    () =>
      debounce(async (q: string = '') => {
        try {
          const resp = await userService.searchAllUser({ q, limit: 50 });
          const { data } = resp.data;

          // Check if have defaultValue and put this model to the list if have
          const cur = (value ?? selectedValue ?? defaultValue) as string | undefined;
          if (cur && !data.find((p: any) => p._id === cur)) {
            try {
              const user = await userService.findById(cur);
              data.unshift(user.data);
            } catch {
              // ignore
            }
          }

          setUsers(data);
        } catch {
          message.error('Error occurred, please try again!');
        }
      }, 300),
    [value, selectedValue, defaultValue]
  );

  useEffect(() => {
    searchUsers();
    return () => searchUsers.cancel();
  }, [searchUsers]);

  const emitChange = (val: string | undefined) => {
    setSelectedValue(val);
    onChange?.(val); // để AntD Form nhận giá trị
    onSelect?.(val ?? ''); // giữ callback cũ nếu nơi khác đang dùng
  };

  return (
    <Select
      ref={selectRef}
      showSearch
      value={currentValue}
      placeholder={placeholder}
      defaultActiveFirstOption={false}
      filterOption={false}
      onSearch={(q) => searchUsers(q)}
      onChange={(val) => emitChange(val)}
      allowClear
      onClear={() => emitChange(undefined)}
      notFoundContent={null}
      disabled={disabled}
      style={{ width: '100%' }}
    >
      {!noEmpty && (
        <Select.Option key="empty" value="">
          <em>None</em>
        </Select.Option>
      )}
      {users.map((u: any) => (
        <Select.Option key={u._id} value={u._id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar src={u.avatar || '/no-avatar.png'} size="small" alt={u.name || u.username} />
            <span>{u.name || u.username} ({u.email})</span>
          </div>
        </Select.Option>
      ))}
    </Select>
  );
}

export default UserSelector;
