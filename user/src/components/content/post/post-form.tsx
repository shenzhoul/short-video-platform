'use client';

import { shouldResetPostTypeOnUploadModalCancel } from '@components/content/post/post-form.utils';
import { PostTypeValue } from '@components/content/post/post-form-toolbar';
import { FileThumb } from '@components/shared';
import Button from '@components/ui/button';
import { usePostTopics } from '@hooks/use-post-topics';
import { useSearchSuggestions } from '@hooks/use-search-suggestions';
import { IPost } from '@interfaces/post';
import { IUser } from '@interfaces/user';
import { getBase64 } from '@lib/utils';
import { FILE_VALIDATION_PRESETS, validateFileSize } from '@utils/file-validation';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FiImage, FiPlus, FiVideo } from 'react-icons/fi';
import { toast } from 'react-toastify';

const Modal = dynamic(() => import('@components/ui/modal'));
const ComposerTextarea = dynamic(() => import('./composer-textarea'), { ssr: false });
const PostFormToolbar = dynamic(() => import('./post-form-toolbar').then(m => ({ default: m.PostFormToolbar })));
const UploadMediaModal = dynamic(() => import('./upload-media-modal').then(m => ({ default: m.UploadMediaModal })));

export const POST_TYPE_OPTIONS = [
  { label: 'Text', value: 'text' },
  { label: 'Photo', value: 'photo' },
  { label: 'Video', value: 'video' }
] as const;

const MAX_MEDIA_FILES = 12; // Maximum number of media files allowed
interface PostFormProps {
  post?: IPost;
  onSubmit: (
    data: Partial<IPost> & { poll?: any },
    files: { files: File[], thumbnail: File | null, teaser: File | null },
    removedData: { files: string[], thumbnailId: boolean, teaserId: boolean, oldThumbnailId: string | null, oldTeaserId: string | null }
  ) => void;
  uploading: boolean;
  uploadPercentage: number;
  showCancelButton?: boolean;
}

export const PostForm: React.FC<PostFormProps> = ({
  post,
  onSubmit,
  uploading,
  uploadPercentage,
  showCancelButton = true
}) => {
  const router = useRouter();

  // Upload modal for main media
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Media files for photo / video / audio
  const [existingFiles, setExistingFiles] = useState<any[]>([]);
  const [existingThumbnail, setExistingThumbnail] = useState<any>(null);
  const [existingTeaser, setExistingTeaser] = useState<any>(null);

  // New selected files for photo / video / audio
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedThumbnail, setSelectedThumbnail] = useState<File | null>(null);
  const [selectedTeaser, setSelectedTeaser] = useState<File | null>(null);

  // Removed existing file IDs
  const [removedFileIds, setRemovedFileIds] = useState<string[]>([]);
  const [removedThumbnailId, setRemovedThumbnailId] = useState<boolean>(false);
  const [removedTeaserId, setRemovedTeaserId] = useState<boolean>(false);

  // Track old thumbnail/teaser IDs for deletion when replacing
  const [oldThumbnailId, setOldThumbnailId] = useState<string | null>(null);
  const [oldTeaserId, setOldTeaserId] = useState<string | null>(null);

  // Preview modal state
  const [previewFile, setPreviewFile] = useState<any>(null);
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image');

  // Warning messages for file selection
  const [fileSelectionWarning, setFileSelectionWarning] = useState<{
    photo: string;
    video: string;
    thumbnail: string;
    teaser: string;
  }>({
    photo: '',
    video: '',
    thumbnail: '',
    teaser: ''
  });
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<Partial<IPost>>({
    defaultValues: (post ? {
      ...post
    } : {
      text: '',
      type: 'text',
      status: 'active'
    }) as Partial<IPost>
  });

  const postType = watch('type');
  const topics = usePostTopics();
  // Trending hashtags double as the "hotspot" list — a trending tag carries the same meaning here
  // without a separate Hotspot entity to maintain.
  // A "hotspot" is an actual hashtag, so it reads from tag suggestions rather than the discovery
  // panels, which now return readable phrases instead of tags.
  const { tags: hotTopics } = useSearchSuggestions('', 'tag', true);
  const [topicKey, setTopicKey] = useState<string>(post?.topicKey || '');
  const [associatedTag, setAssociatedTag] = useState<string>(post?.associatedTag || '');
  const [mentionedUsers, setMentionedUsers] = useState<IUser[]>([]);

  useEffect(() => {
    setTopicKey(post?.topicKey || '');
    setAssociatedTag(post?.associatedTag || '');
  }, [post?._id, post?.topicKey, post?.associatedTag]);

  // ComposerTextarea owns the input, so the field is registered manually to keep react-hook-form's
  // validation and submitted values while the value is driven through setValue.
  useEffect(() => {
    register('text', { required: 'Text is required' });
  }, [register]);

  const resetPostStates = useCallback(() => {
    if (post) {
      setValue('type', post.type);
      // Clear selected files
      setSelectedFiles([]);
      setSelectedThumbnail(null);
      setSelectedTeaser(null);

      // reset thumbnail and teaser when type changes
      setOldTeaserId(null);
      setExistingFiles(post.files || []);

      // Set thumbnail and teaser
      if (post.thumbnailUrl && post.thumbnailId) {
        setExistingThumbnail({
          _id: post.thumbnailId,
          url: post.thumbnailUrl,
          thumbnails: [post.thumbnailUrl],
          mimeType: 'image/',
          name: 'Thumbnail'
        });
        setOldThumbnailId(post.thumbnailId);
        setRemovedThumbnailId(false);
      }

      if (post.teaser) {
        setExistingTeaser(post.teaser);
        setRemovedTeaserId(false);
      } else if (post.teaserId && (post as any).teaserUrl) {
        setExistingTeaser({
          _id: post.teaserId,
          url: (post as any).teaserUrl,
          mimeType: 'video/',
          name: 'Teaser Video'
        });
        setRemovedTeaserId(false);
      }
    }
  }, [post, setValue, setSelectedFiles, setSelectedThumbnail, setSelectedTeaser, setExistingFiles, setOldTeaserId, setOldThumbnailId, setRemovedThumbnailId, setRemovedTeaserId, setExistingThumbnail, setExistingTeaser]);

  // Reset files when type changes
  useEffect(() => {
    if (post) {
      // if post type is changed, set removed file ids to post file ids
      if (post.type !== postType) {
        setRemovedFileIds(post?.fileIds || []);
        setSelectedFiles([]);
        setExistingFiles([]);
        setExistingThumbnail(null);
        setExistingTeaser(null);
        setRemovedThumbnailId(false);
        setRemovedTeaserId(false);
        setOldThumbnailId(null);
        setOldTeaserId(null);
        setFileSelectionWarning({
          photo: '',
          video: '',
          thumbnail: '',
          teaser: ''
        });
      } else {
        // if post type is not changed, set removed file ids to empty array
        resetPostStates();
      }
    }
  }, [postType, post, resetPostStates]);

  // Handle file selection (thumbnail / teaser only; main files go via UploadMediaModal)
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: 'thumbnail' | 'teaser') => {
    const files = e.target.files;
    if (!files) return;
    const file = files[0];
    const maxSizeMB = type === 'thumbnail'
      ? FILE_VALIDATION_PRESETS.IMAGE.maxSizeMB
      : FILE_VALIDATION_PRESETS.TEASER_VIDEO.maxSizeMB;
    const validation = validateFileSize(file, maxSizeMB);

    if (!validation.isValid) {
      const message = validation.error || 'The selected file is too large.';
      setFileSelectionWarning(prev => ({ ...prev, [type]: message }));
      toast.error(message);
      e.target.value = '';
      return;
    }

    setFileSelectionWarning(prev => ({ ...prev, [type]: '' }));
    if (type === 'thumbnail') setSelectedThumbnail(file);
    else if (type === 'teaser') setSelectedTeaser(file);
    e.target.value = '';
  };

  // Remove selected file
  const removeSelectedFile = (type: 'files' | 'thumbnail' | 'teaser', index?: number) => {
    if (type === 'files' && index !== undefined) {
      setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    } else if (type === 'thumbnail') {
      setSelectedThumbnail(null);
    } else if (type === 'teaser') {
      setSelectedTeaser(null);
    }
  };

  // Remove existing file
  const removeExistingFile = (fileId: string, type: 'file' | 'thumbnail' | 'teaser') => {
    if (type === 'file') {
      setExistingFiles(prev => prev.filter(f => f._id !== fileId));
      setRemovedFileIds(prev => [...prev, fileId]);
    } else if (type === 'thumbnail') {
      setExistingThumbnail(null);
      setRemovedThumbnailId(true);
    } else if (type === 'teaser') {
      setExistingTeaser(null);
      setRemovedTeaserId(true);
    }
  };

  // Handle preview
  const handlePreview = async (file: any) => {
    const fileToRead = file?.originFileObj || file;
    if (!file.url && !file.preview && fileToRead) {
      file.preview = await getBase64(fileToRead);
    }

    // Determine if it's an image or video
    const fileUrl = file.url || file.preview;
    const fileName = file.name || (file.url ? file.url.substring(file.url.lastIndexOf('/') + 1) : '');
    const mimeType = file?.mimeType || file?.type;
    let isVideo = false;
    if (mimeType) {
      isVideo = mimeType.includes('video');
    } else if (fileName) {
      // Fallback: check file extension
      const ext = fileName.toLowerCase().split('.').pop();
      isVideo = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'hevc'].includes(ext || '');
    }

    setPreviewFile({ ...file, url: fileUrl });
    setPreviewType(isVideo ? 'video' : 'image');
  };

  const onFormSubmit = (data: Partial<IPost>) => {
    // Clear previous warnings
    setFileSelectionWarning({
      photo: '',
      video: '',
      thumbnail: '',
      teaser: ''
    });

    const payload: Partial<IPost> = {
      ...data,
      topicKey: topicKey || null,
      associatedTag: associatedTag || null,
      // The server re-verifies these ids; sending them just saves it re-resolving names from text.
      mentionedUserIds: mentionedUsers.map(user => user._id)
    };

    // Type-specific validation
    if (['photo', 'video'].includes(data.type)) {
      if (selectedFiles.length === 0 && existingFiles.length === 0) {
        const msg = data.type === 'video' ? 'Please select at least one video file!' : 'Please select at least one media file!';
        setFileSelectionWarning(prev => ({ ...prev, [data.type]: msg }));
        return;
      }
    }

    // Prepare files for upload
    const files = {
      files: selectedFiles,
      thumbnail: selectedThumbnail,
      teaser: selectedTeaser
    };

    // Prepare removal data
    const removedData = {
      files: removedFileIds,
      thumbnailId: removedThumbnailId,
      teaserId: removedTeaserId,
      oldThumbnailId,
      oldTeaserId
    };
    onSubmit(payload, files, removedData);
  };

  const renderMediaUpload = (mode: string) => {
    const showMainFiles = mode !== 'scheduled_stream';
    const showThumbnail = ['photo', 'video'].includes(mode);
    const showTeaser = ['video'].includes(mode);

    return (
      <div className="mt-4 w-full p-2">
        {showMainFiles ? (
          <div>
            {/* <label className="block text-sm font-medium text-gray-700 mb-2">{mainLabel} *</label> */}
            <div className="flex flex-wrap items-center gap-2">
              {existingFiles.map((file, index) => (
                <FileThumb
                  key={file._id || `existing-${index}`}
                  file={file}
                  size={96}
                  showRemove
                  onClick={() => handlePreview(file)}
                  onRemove={() => removeExistingFile(file._id, 'file')}
                />
              ))}
              {selectedFiles.map((file, index) => (
                <FileThumb
                  key={`${file.name}-${file.lastModified}-${index}`}
                  file={file}
                  size={96}
                  showRemove
                  onClick={() => handlePreview(file)}
                  onRemove={() => removeSelectedFile('files', index)}
                />
              ))}
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="w-24 h-24 flex flex-col items-center justify-center gap-1 border-2 border-dashed border-border rounded-lg text-gray-400 hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors"
              >
                <FiPlus size={24} />
                <span className="text-xs font-medium">Add</span>
              </button>
            </div>
            {fileSelectionWarning.photo || fileSelectionWarning.video ? (
              <p className="text-red-500 text-sm mt-1">
                {fileSelectionWarning.photo || fileSelectionWarning.video}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center gap-2 mt-2">
          {showThumbnail ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Thumbnail (Optional, Max {FILE_VALIDATION_PRESETS.IMAGE.maxSizeMB}MB)</label>
              <div>
                {/* Existing thumbnail */}
                {existingThumbnail ? (
                  <FileThumb
                    key={existingThumbnail._id || 'existing-thumbnail'}
                    file={existingThumbnail}
                    showRemove
                    onClick={() => handlePreview(existingThumbnail)}
                    onRemove={() => removeExistingFile(existingThumbnail._id, 'thumbnail')}
                  />
                ) : null}

                {/* Selected thumbnail */}
                {selectedThumbnail ? (
                  <FileThumb
                    key="selected-thumbnail"
                    file={selectedThumbnail}
                    showRemove
                    onClick={() => handlePreview(selectedThumbnail)}
                    onRemove={() => removeSelectedFile('thumbnail')}
                  />
                ) : null}

                {/* Add button - only show if no thumbnail selected */}
                {!selectedThumbnail && !existingThumbnail && (
                  <button
                    type="button"
                    onClick={() => document.getElementById('thumbnail-input')?.click()}
                    className="w-24 h-24 flex items-center justify-center border-2 border-dashed rounded-md text-gray-400 hover:text-gray-600 hover:border-gray-400 transition"
                  >
                    <FiImage size={32} />
                  </button>
                )}
              </div>
              <input
                id="thumbnail-input"
                type="file"
                accept="image/*,.heic,.heif,.avif,.tiff,.tif"
                className="hidden"
                onChange={e => handleFileSelect(e, 'thumbnail')}
              />
              {fileSelectionWarning.thumbnail ? <p className="text-red-500 text-sm mt-1">{fileSelectionWarning.thumbnail}</p> : null}
            </div>
          ) : null}

          {showTeaser ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Teaser (Optional, Max {FILE_VALIDATION_PRESETS.TEASER_VIDEO.maxSizeMB}MB)</label>
              <div>
                {/* Existing teaser */}
                {existingTeaser ? (
                  <FileThumb
                    key={existingTeaser._id || 'existing-teaser'}
                    file={existingTeaser}
                    showRemove
                    onClick={() => handlePreview(existingTeaser)}
                    onRemove={() => removeExistingFile(existingTeaser._id, 'teaser')}
                  />
                ) : null}

                {/* Selected teaser */}
                {selectedTeaser ? (
                  <FileThumb
                    key="selected-teaser"
                    file={selectedTeaser}
                    showRemove
                    onClick={() => handlePreview(selectedTeaser)}
                    onRemove={() => removeSelectedFile('teaser')}
                  />
                ) : null}

                {/* Add button - only show if no teaser selected */}
                {!selectedTeaser && !existingTeaser && (
                  <button
                    type="button"
                    onClick={() => document.getElementById('teaser-input')?.click()}
                    className="w-24 h-24 flex items-center justify-center border-2 border-dashed rounded-md text-gray-400 hover:text-gray-600 hover:border-gray-400 transition"
                  >
                    <FiVideo size={32} />
                  </button>
                )}
              </div>
              <input
                id="teaser-input"
                type="file"
                multiple={false}
                accept="video/*,.hevc,.mov"
                className="hidden"
                onChange={e => handleFileSelect(e, 'teaser')}
              />
              {fileSelectionWarning.teaser ? <p className="text-red-500 text-sm mt-1">{fileSelectionWarning.teaser}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const showMediaUpload = ['photo', 'video'].includes(postType);

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="mt-4 w-full">
      <ComposerTextarea
        value={watch('text') || ''}
        onChange={(value) => setValue('text', value, { shouldValidate: true })}
        onMentionsChange={setMentionedUsers}
        placeholder={!post ? 'Compose new post...' : 'Add description...'}
      />
      {errors.text ? <p className="mt-1 text-xs text-red-500">{errors.text.message}</p> : null}

      <div className="mt-3 flex flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="post-topic" className="mb-1 block text-[14px] leading-5 text-white/90">
            Topic <span className="text-white/45">(optional)</span>
          </label>
          <select
            id="post-topic"
            value={topicKey}
            onChange={(event) => setTopicKey(event.target.value)}
            className="w-full cursor-pointer rounded-[10px] border-0 bg-[#363743] px-2 py-2 text-sm leading-5 text-white/75 outline-none focus:bg-[#3b3c49]"
          >
            <option value="">No topic</option>
            {topics.map(topic => (
              <option key={topic.key} value={topic.key}>{topic.label}</option>
            ))}
          </select>
        </div>

        {hotTopics.length ? (
          <div className="min-w-0 flex-1">
            <label htmlFor="post-hotspot" className="mb-1 block text-[14px] leading-5 text-white/90">
              Associated hotspot <span className="text-white/45">(optional)</span>
            </label>
            <select
              id="post-hotspot"
              value={associatedTag}
              onChange={(event) => setAssociatedTag(event.target.value)}
              className="w-full cursor-pointer rounded-[10px] border-0 bg-[#363743] px-2 py-2 text-sm leading-5 text-white/75 outline-none focus:bg-[#3b3c49]"
            >
              <option value="">No hotspot</option>
              {hotTopics.map(topic => (
                <option key={topic.tag} value={topic.tag}>
                  #{topic.tag} ({topic.postCount})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {showMediaUpload ? renderMediaUpload(postType) : null}

      {uploading ? (
        <div className="w-full">
          <div
            className="bg-primary text-xs font-medium text-blue-100 text-center p-0.5 leading-none rounded-full"
            style={{ width: `${uploadPercentage}%` }}
          >
            {`${Math.round(uploadPercentage)}%`}
          </div>
        </div>
      ) : null}

      <PostFormToolbar
        initialType={(post ? post.type : 'text') as PostTypeValue}
        postType={postType as PostTypeValue}
        setPostType={(type) => setValue('type', type)}
        onPostTypeWithMedia={() => setUploadModalOpen(true)}
        status={watch('status') || 'active'}
        setStatus={(status) => setValue('status', status)}
        isEditing={!!post}
        uploading={uploading}
      />

      <div className="flex justify-end items-center gap-2">
        {showCancelButton ? (
          <Button type="button" onClick={() => router.push('/content/posts')} variant='grey-light'>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={uploading} disabled={uploading}>
          {uploading ? 'Processing...' : (post ? 'Update Post' : 'Create Post')}
        </Button>
      </div>

      {/* Upload media modal */}
      {['photo', 'video'].includes(postType) ? (
        <UploadMediaModal
          open={uploadModalOpen}
          onOk={(newSelectedFiles, newExistingFiles) => {
            const removedIds = existingFiles
              .filter(f => !newExistingFiles.find(nf => nf._id === f._id))
              .map(f => f._id);
            if (removedIds.length > 0) {
              setRemovedFileIds(prev => [...prev, ...removedIds]);
            }
            setSelectedFiles(newSelectedFiles);
            setExistingFiles(newExistingFiles);
            setUploadModalOpen(false);
          }}
          onCancel={() => {
            if (shouldResetPostTypeOnUploadModalCancel({
              hasPost: !!post,
              existingFileCount: existingFiles.length,
              selectedFileCount: selectedFiles.length
            })) {
              setValue('type', 'text');
            }

            setUploadModalOpen(false);
          }}
          mode={postType as 'photo' | 'video'}
          existingFiles={existingFiles}
          selectedFiles={selectedFiles}
          maxFiles={MAX_MEDIA_FILES}
          onPreview={handlePreview}
        />
      ) : null}

      {/* Preview Modal */}
      {!!previewFile ? (
        <Modal
          title={previewFile?.name || 'Preview'}
          open={!!previewFile}
          onCancel={() => setPreviewFile(null)}
          width={previewType === 'image' ? 'auto' : '800px'}
          footer={false}
        >
          {previewType === 'image' ? (
            <img alt="preview" className="max-w-full max-h-[70vh] object-contain" src={previewFile?.url} />
          ) : (
            <video
              controls
              className="max-w-full max-h-[70vh]"
              src={previewFile?.url}
              autoPlay
            >
              Your browser does not support the video tag.
            </video>
          )}
        </Modal>
      ) : null}
    </form>
  );
};
