'use client';

import Dropdown from '@components/ui/dropdown-menu';
import { useComposerSuggestions } from '@hooks/use-composer-suggestions';
import type { PostCoverRatio } from '@hooks/use-post-create';
import { usePostTopics } from '@hooks/use-post-topics';
import type { IUser } from '@interfaces/user';
import { type FormEvent, type RefObject, useEffect } from 'react';
import { FiChevronDown, FiChevronRight, FiPlus, FiX } from 'react-icons/fi';
import { DouyinFavicon } from 'src/icons';

import PostCoverSelector from './post-cover-selector';
import {
  postCreateControlClassName,
  postCreateDropdownMenuClassName,
  PostCreateField,
  PostCreateSection
} from './post-create-layout';

const selectedTopicPillClassName = 'ml-2 flex h-5 cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap rounded-sm border border-solid border-[#fe2c55] bg-[#fe2c55]/12 px-2 py-0.5 text-xs leading-[18px] font-semibold text-[#fe2c55] transition';

const incentiveActivities = [
  { title: 'Sing anywhere and win creator rewards', participants: 417 },
  { title: 'Join the dance creator challenge', participants: 267 },
  { title: 'Capture your best sports moment', participants: 393 }
];

interface PostCreateBasicInformationProps {
  mode?: 'create' | 'edit';
  title: string;
  description: string;
  descriptionEditorRef: RefObject<HTMLDivElement | null>;
  generatedCoverUrls: string[];
  selectedCoverIndex: number | null;
  customCoverUrls: Partial<Record<PostCoverRatio, string>>;
  existingCoverUrls?: Partial<Record<PostCoverRatio, string>>;
  isSubmitting: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCoverSelect: (ratio: PostCoverRatio, file: File) => void;
  onAiCoverSelect: (index: number) => void;
  topicKey?: string;
  onTopicChange?: (topicKey: string) => void;
  onMentionsChange?: (users: IUser[]) => void;
}

interface DescriptionEditorProps {
  title: string;
  description: string;
  descriptionEditorRef: RefObject<HTMLDivElement | null>;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  mediaLabel?: 'video' | 'graphics';
  titleMaxLength?: number;
  /** Selected topic key, or '' for none. Optional so composers can omit the picker entirely. */
  topicKey?: string;
  onTopicChange?: (topicKey: string) => void;
  onMentionsChange?: (users: IUser[]) => void;
}

export function PostCreateDescriptionEditor({
  title,
  description,
  descriptionEditorRef,
  onTitleChange,
  onDescriptionChange,
  mediaLabel = 'video',
  titleMaxLength = 30,
  topicKey = '',
  onTopicChange,
  onMentionsChange
}: DescriptionEditorProps) {
  // Topics come from the API so the labels shown map to keys the server will accept.
  const topics = usePostTopics();
  const selectedTopic = topics.find(topic => topic.key === topicKey) || null;
  const suggestions = useComposerSuggestions({
    editorRef: descriptionEditorRef,
    onChange: onDescriptionChange,
    onMentionsChange
  });

  useEffect(() => {
    const editor = descriptionEditorRef.current;
    if (!editor || editor.innerText === description) return;

    const isActivelyEditing = document.activeElement === editor && editor.innerText.length > 0;
    if (!isActivelyEditing) editor.textContent = description;
  }, [description, descriptionEditorRef]);

  const handleDescriptionInput = (event: FormEvent<HTMLDivElement>) => {
    const editor = event.currentTarget;
    const nextDescription = editor.innerText.slice(0, 1000);
    if (editor.innerText !== nextDescription) editor.textContent = nextDescription;
    onDescriptionChange(nextDescription);
    suggestions.detectTrigger();
    suggestions.syncMentions(nextDescription);
  };

  return (
    <PostCreateField
      className="mt-6"
      label="Description"
      tooltip={`1. The title of the work only supports text input. If you need to add #topic and @friend, please enter it in the work introduction area
2. Titled works will be displayed first in the dual-column layout, and the preview effect can be viewed in "Preview Cover/Title" on the right
3. Please avoid filling in the same content in the title and introduction of the work.`}
      tooltipWidth="w-[240px]"
      tooltipPosition='bottom'
    >
      <div className="relative w-full">
        <div className="relative min-w-full max-w-full rounded-sm border border-solid border-transparent bg-(--action-card-bg) px-3 pb-3 pt-2 transition hover:border-[#fe2c55] focus-within:border-[#fe2c55]">
          <div className="relative mb-2 border-b border-solid border-b-(--input-panel-divider) pb-2">
            <div className="flex h-5 justify-between rounded-sm bg-transparent">
              <input
                placeholder={`Add a title that describes your ${mediaLabel}`}
                maxLength={titleMaxLength}
                value={title}
                onChange={event => onTitleChange(event.target.value)}
                className="h-[30px] w-full bg-transparent text-sm text-(--text-strong) caret-[#fe2c55] outline-none placeholder:text-(--text-muted)"
              />
              <div className="flex w-[31px] items-center justify-center text-right text-xs text-(--text-muted)">
                {title.length}/{titleMaxLength}
              </div>
            </div>
          </div>
          {/* Relative wrapper: the dropdown must be a sibling, never inside the contentEditable,
              or it would become part of the edited content. */}
          <div className="relative">
            <div
              ref={descriptionEditorRef}
              contentEditable
              suppressContentEditableWarning
              data-placeholder={`Share more about your ${mediaLabel} here...`}
              role="textbox"
              aria-label={`${mediaLabel === 'video' ? 'Video' : 'Graphics'} description`}
              onInput={handleDescriptionInput}
              onKeyDown={suggestions.handleKeyDown}
              onKeyUp={suggestions.detectTrigger}
              onClick={suggestions.detectTrigger}
              onBlur={() => {
                // Delayed so a click on an option is registered before the dropdown unmounts.
                window.setTimeout(suggestions.closeSuggestions, 150);
              }}
              className="relative min-h-[92px] max-h-[200px] overflow-hidden whitespace-pre-wrap wrap-break-word rounded-sm text-sm leading-relaxed text-(--text-strong) caret-[#fe2c55] outline-none antialiased empty:before:pointer-events-none empty:before:text-(--text-muted) empty:before:content-[attr(data-placeholder)]"
            />

            {suggestions.isOpen ? (
              <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-(--border-soft) bg-(--surface-raised) py-1 shadow-(--shadow-popover)">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--text-muted)">
                  {suggestions.triggerType === 'user' ? 'Users' : 'Hashtags'}
                </p>
                {suggestions.loading && !suggestions.options.length ? (
                  <p className="px-3 py-2 text-[13px] text-(--text-muted)">Searching...</p>
                ) : null}
                {!suggestions.loading && !suggestions.options.length ? (
                  <p className="px-3 py-2 text-[13px] text-(--text-muted)">
                    {suggestions.triggerType === 'user' ? 'No matching users' : 'No matching hashtags'}
                  </p>
                ) : null}
                {suggestions.options.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    // Mouse down fires before blur, so the pick is not lost to the blur handler.
                    onMouseDown={(event) => {
                      event.preventDefault();
                      suggestions.applyOption(option);
                    }}
                    onMouseEnter={() => suggestions.setHighlighted(index)}
                    className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${index === suggestions.highlighted
                      ? 'bg-(--hover-bg) text-(--text-strong)'
                      : 'text-(--text) hover:bg-(--hover-bg)'}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {option.user ? (
                        <img
                          src={option.user.avatar || '/no_avatar.jpeg'}
                          alt=""
                          className="h-6 w-6 shrink-0 rounded-full object-cover"
                        />
                      ) : null}
                      <span className="truncate font-medium">{option.label}</span>
                    </span>
                    {option.hint ? (
                      <span className="shrink-0 text-xs text-(--text-muted)">{option.hint}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <div className="flex w-full items-center">
              <button
                type="button"
                onMouseDown={(event) => {
                  // Keeps focus in the editor so the caret position stays valid.
                  event.preventDefault();
                  suggestions.insertTrigger('#');
                }}
                className="uppercase mr-4 inline-flex h-3 cursor-pointer rounded-sm bg-transparent text-sm leading-3.5 text-(--text-muted) transition hover:text-[#fe2c55]"
              >
                # Hashtags
              </button>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  suggestions.insertTrigger('@');
                }}
                className="uppercase inline-flex h-3 cursor-pointer rounded-sm bg-transparent text-sm leading-3.5 text-(--text-muted) transition hover:text-[#fe2c55]"
              >
                @ Mention
              </button>
            </div>
            <div className="text-right text-xs text-(--text-muted)">{description.length}/1000</div>
          </div>
          <div className="mt-2 h-px -translate-x-3 bg-(--section-divider) w-[calc(100%+24px)]" />
          {onTopicChange ? (
            <div className="flex items-center pt-3">
              <div className="w-7 shrink-0 whitespace-nowrap text-xs leading-5 text-(--text-muted)">Topic</div>
              <div className="flex w-full flex-auto items-center">
                {selectedTopic ? (
                  <button
                    type="button"
                    onClick={() => onTopicChange('')}
                    title="Remove topic"
                    className={selectedTopicPillClassName}
                  >
                    {selectedTopic.label}
                    <FiX className="ml-1 text-[11px]" />
                  </button>
                ) : (
                  <span className="ml-2 text-xs leading-5 text-(--text-muted)">No topic</span>
                )}

                <Dropdown
                  triggerMode="click"
                  position="left"
                  width={240}
                  className="ml-2 shrink-0"
                  menuClassName={postCreateDropdownMenuClassName}
                  trigger={(
                    <button
                      type="button"
                      aria-label="Choose a topic"
                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm border border-solid border-(--tag-border) bg-(--tag-bg) text-(--text-muted) transition hover:border-[#fe2c55] hover:text-[#fe2c55]"
                    >
                      <FiPlus className="text-[12px]" />
                    </button>
                  )}
                >
                  <div className="max-h-64 overflow-y-auto py-1">
                    <button
                      type="button"
                      onClick={() => onTopicChange('')}
                      className={`flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm transition hover:bg-(--hover-bg) ${topicKey ? 'text-(--text)' : 'font-semibold text-[#fe2c55]'}`}
                    >
                      No topic
                    </button>
                    {topics.map(topic => (
                      <button
                        type="button"
                        key={topic.key}
                        onClick={() => onTopicChange(topic.key)}
                        className={`flex w-full cursor-pointer items-center px-3 py-2 text-left text-sm transition hover:bg-(--hover-bg) ${topicKey === topic.key ? 'font-semibold text-[#fe2c55]' : 'text-(--text)'}`}
                      >
                        {topic.label}
                      </button>
                    ))}
                  </div>
                </Dropdown>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </PostCreateField>
  );
}

export function PostCreateIncentiveActivityField() {
  return (
    <PostCreateField
      className="mt-6"
      label="Incentive activity"
      tooltip="Adding activities will give your post an opportunity to earn traffic rewards."
      tooltipWidth="w-[240px]"
    >
      <div className="flex">
        {incentiveActivities.map(activity => (
          <button
            type="button"
            key={activity.title}
            className="group mr-2 flex h-[54px] w-[164px] flex-col justify-between rounded-sm bg-(--action-card-bg) px-2 py-3 text-left transition hover:bg-(--action-card-hover-bg)"
          >
            <span className="inline-flex items-center">
              <DouyinFavicon className="mr-1 shrink-0 text-xs" />
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold leading-[18px] text-(--action-card-title)">
                {activity.title}
              </span>
            </span>
            <span className="text-xs text-(--text-muted)">Vibrant: {activity.participants}</span>
          </button>
        ))}
        <button type="button" className="flex h-[54px] w-9 items-center justify-center rounded-sm bg-(--action-card-bg) text-xs text-(--text-muted) transition hover:bg-(--action-card-hover-bg)">
          +59
        </button>
      </div>
    </PostCreateField>
  );
}

export function PostCreateCollectionFields({ showCollection = true }: { showCollection?: boolean }) {
  return (
    <>
      {showCollection ? (
        <PostCreateField className="mt-6" label="Add collection">
          <div className="flex whitespace-nowrap">
            <Dropdown
              className="shrink-0"
              trigger={(
                <button type="button" className={`${postCreateControlClassName} w-[120px]`}>
                  <span className="max-w-[70px] overflow-hidden text-ellipsis">Collection</span>
                  <FiChevronDown className="text-base text-(--text-muted)" />
                </button>
            )}
              width={104}
              position="left"
              menuClassName={postCreateDropdownMenuClassName}
            >
              <button type="button" className="block h-8 w-full rounded-sm px-2 text-left text-sm text-(--text-strong) hover:bg-(--surface-muted)">
                collection
              </button>
            </Dropdown>
            <Dropdown
              className="ml-2 flex-1"
              trigger={(
                <button type="button" className={`${postCreateControlClassName} w-full`}>
                  <span>Please select a collection</span>
                  <FiChevronDown className="text-base text-(--text-muted)" />
                </button>
            )}
              width="100%"
              position="left"
              menuClassName={postCreateDropdownMenuClassName}
            >
              <button type="button" className="block h-9 w-full rounded-sm px-8 text-left text-sm text-(--text-strong) hover:bg-(--surface-muted)">
                Please select collection
              </button>
            </Dropdown>
          </div>
        </PostCreateField>
) : null}
      <PostCreateField className={showCollection ? 'mt-3' : 'mt-6'} label="Autonomous">
        <button type="button" className={`${postCreateControlClassName} w-full text-(--text-muted) hover:text-(--text-strong)`}>
          <span>Please choose to make a self-declaration</span>
          <FiChevronRight className="text-xl text-(--text-muted)" />
        </button>
      </PostCreateField>
    </>
  );
}

export default function PostCreateBasicInformation({
  mode = 'create',
  title,
  description,
  descriptionEditorRef,
  generatedCoverUrls,
  selectedCoverIndex,
  customCoverUrls,
  existingCoverUrls,
  isSubmitting,
  onTitleChange,
  onDescriptionChange,
  onCoverSelect,
  onAiCoverSelect,
  topicKey,
  onTopicChange,
  onMentionsChange
}: PostCreateBasicInformationProps) {
  const isEdit = mode === 'edit';

  return (
    <PostCreateSection title="Basic information">
      {isEdit ? null : (
        <button
          type="button"
          className="absolute right-8 top-6 rounded-[40px] bg-(--action-card-bg) px-3 py-1 text-sm font-semibold leading-5 text-(--text-strong) transition hover:bg-(--surface-hover)"
        >
          Fill in quickly
        </button>
)}
      <PostCreateDescriptionEditor
        title={title}
        description={description}
        descriptionEditorRef={descriptionEditorRef}
        onTitleChange={onTitleChange}
        onDescriptionChange={onDescriptionChange}
        topicKey={isEdit ? undefined : topicKey}
        onTopicChange={isEdit ? undefined : onTopicChange}
        onMentionsChange={onMentionsChange}
      />
      <PostCreateIncentiveActivityField />
      <PostCreateField
        className="mt-6"
        label="Set cover"
        tooltip="Making two covers helps increase video exposure."
        tooltipWidth="w-[240px]"
      >
        <PostCoverSelector
          generatedCoverUrls={generatedCoverUrls}
          selectedCoverIndex={selectedCoverIndex}
          customCoverUrls={customCoverUrls}
          existingCoverUrls={existingCoverUrls}
          mode={mode}
          disabled={isSubmitting}
          onCoverSelect={onCoverSelect}
          onAiCoverSelect={onAiCoverSelect}
        />
      </PostCreateField>
      <PostCreateCollectionFields showCollection={!isEdit} />
    </PostCreateSection>
  );
}
