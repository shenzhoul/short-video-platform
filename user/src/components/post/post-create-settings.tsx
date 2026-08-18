import { RadioButtonGroup } from '@components/ui/radio-button-group';

import { PostCreateField, PostCreateSection } from './post-create-layout';

const watchOptions = [
  { label: 'Everyone', value: 'everyone' },
  { label: 'Friends', value: 'friends' },
  { label: 'Only you', value: 'only-you' }
];
const savePermissionOptions = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' }
];
const publishTimeOptions = [
  { label: 'Now', value: 'now' },
  { label: 'Schedule', value: 'schedule' }
];

export default function PostCreateSettings() {
  return (
    <PostCreateSection title="Settings">
      <div className="mt-6 space-y-6">
        <PostCreateField label="Who can watch?">
          <RadioButtonGroup name="Who can watch" options={watchOptions} defaultValue="everyone" />
        </PostCreateField>
        <PostCreateField label="Save permission" tooltip="Allow viewers to save this post." tooltipWidth="w-[180px]">
          <RadioButtonGroup name="Save permission" options={savePermissionOptions} defaultValue="yes" />
        </PostCreateField>
        <PostCreateField
          label="When to post"
          tooltip="Publish immediately or schedule this post for later."
          tooltipWidth="w-[200px]"
        >
          <RadioButtonGroup name="When to post" options={publishTimeOptions} defaultValue="now" />
        </PostCreateField>
      </div>
    </PostCreateSection>
  );
}
