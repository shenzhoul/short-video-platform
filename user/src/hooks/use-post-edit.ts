'use client';

import { getPostImages, getPostVideo } from '@components/content/post/home-feed-media';
import type { GraphicFileItem } from '@hooks/use-post-graphic-create';
import type { IPost } from '@interfaces/post';
import type { IUser } from '@interfaces/user';
import { getPostNotEditableReason, isPostEditable } from '@lib/post-editable';
import { resolveMentionedUserIds } from '@lib/post-mentions';
import { showErrorMessage } from '@lib/utils';
import { findById, update as updatePost, uploadThumbnail } from '@services/post.service';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { toast } from 'react-toastify';

import type { PostCoverRatio } from './use-post-create';

const COVER_RATIOS: PostCoverRatio[] = ['4:3', '3:4'];

interface InitialPostEditValues {
  title: string;
  description: string;
  selectedCoverIndex: number | null;
  selectedPhotoCoverId: string;
  coverDisplayRatio: PostCoverRatio;
}

/**
 * State for editing an already-published post.
 *
 * Deliberately not a variant of `usePostCreate`: that hook exists to shepherd an upload — localStorage
 * drafts, the video handoff from the publish page, access gating — and none of it applies once the
 * post exists. What the two share is the *form*, and that is shared at the component level instead.
 *
 * The media itself is fixed here. Replacing `fileIds` makes the API delete the original video, which
 * is not something an edit screen should risk, so the video is loaded read-only and resent unchanged.
 */
export function usePostEdit(postId: string) {
  const router = useRouter();
  const [post, setPost] = useState<IPost | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topicKey, setTopicKey] = useState('');
  const [mentionedUsers, setMentionedUsers] = useState<IUser[]>([]);
  const [generatedCoverUrls, setGeneratedCoverUrls] = useState<string[]>([]);
  const [selectedCoverIndex, setSelectedCoverIndex] = useState<number | null>(null);
  const [selectedPhotoCoverId, setSelectedPhotoCoverId] = useState('');
  const [selectedCoverFiles, setSelectedCoverFiles] = useState<Partial<Record<PostCoverRatio, File>>>({});
  const [customCoverUrls, setCustomCoverUrls] = useState<Partial<Record<PostCoverRatio, string>>>({});
  const [coverDisplayRatio, setCoverDisplayRatio] = useState<PostCoverRatio>('4:3');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const descriptionEditorRef = useRef<HTMLDivElement>(null);
  const initialValuesRef = useRef<InitialPostEditValues | null>(null);
  // Object URLs for locally picked covers, revoked on unmount so the blobs are not leaked.
  const customCoverUrlsRef = useRef(customCoverUrls);

  useEffect(() => {
    customCoverUrlsRef.current = customCoverUrls;
  }, [customCoverUrls]);

  useEffect(() => () => {
    Object.values(customCoverUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!postId) return;

    let isActive = true;
    setIsLoading(true);
    setLoadError(null);

    findById(postId)
      .then(({ data }) => {
        if (!isActive) return;
        const loaded = data as IPost;
        setPost(loaded);
        setTitle(loaded.title || '');
        setDescription(loaded.text || '');
        setTopicKey(loaded.topicKey || '');
        const loadedPhotoCoverId = loaded.type === 'photo'
          ? loaded.thumbnailId || getPostImages(loaded)[0]?._id || ''
          : '';
        setSelectedPhotoCoverId(loadedPhotoCoverId);
        const loadedCoverDisplayRatio: PostCoverRatio = loaded.coverDisplayRatio === '3:4' ? '3:4' : '4:3';
        setCoverDisplayRatio(loadedCoverDisplayRatio);

        const videoFile = (loaded.files || []).find(file => file?.type?.includes?.('video'));
        const thumbnails = videoFile?.thumbnails?.slice(0, 3) || [];
        setGeneratedCoverUrls(thumbnails);

        // The post stores cover URLs, not the index that produced them. Matching the stored URL back
        // to a generated thumbnail is what lets the picker show the creator's existing choice; when
        // it matches nothing the cover was uploaded, so no thumbnail is highlighted.
        const storedCover = loaded.cover4x3Url || loaded.cover3x4Url || '';
        const matchedIndex = thumbnails.findIndex(url => url === storedCover);
        const loadedCoverIndex = matchedIndex >= 0 ? matchedIndex : null;
        setSelectedCoverIndex(loadedCoverIndex);
        initialValuesRef.current = {
          title: (loaded.title || '').trim(),
          description: (loaded.text || '').trim(),
          selectedCoverIndex: loadedCoverIndex,
          selectedPhotoCoverId: loadedPhotoCoverId,
          coverDisplayRatio: loadedCoverDisplayRatio
        };
      })
      .catch(() => {
        if (!isActive) return;
        setLoadError('This post could not be loaded.');
      })
      .finally(() => {
        if (isActive) setIsLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [postId]);

  const handleCoverSelect = useCallback((ratio: PostCoverRatio, file: File) => {
    setCustomCoverUrls(current => {
      if (current[ratio]) URL.revokeObjectURL(current[ratio]);
      return { ...current, [ratio]: URL.createObjectURL(file) };
    });
    setSelectedCoverFiles(current => ({ ...current, [ratio]: file }));
    setSelectedCoverIndex(null);
  }, []);

  const handleAiCoverSelect = useCallback((index: number) => {
    Object.values(customCoverUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
    setCustomCoverUrls({});
    setSelectedCoverFiles({});
    setSelectedCoverIndex(index);
  }, []);

  const handleCancel = useCallback(() => {
    router.push('/creator/posts');
  }, [router]);

  const initialValues = initialValuesRef.current;
  const isGraphic = post?.type === 'photo';
  const hasChanges = Boolean(initialValues && (
    title.trim() !== initialValues.title
    || description.trim() !== initialValues.description
    || (isGraphic
      ? selectedPhotoCoverId !== initialValues.selectedPhotoCoverId
      : selectedCoverIndex !== initialValues.selectedCoverIndex
        || coverDisplayRatio !== initialValues.coverDisplayRatio
        || Object.keys(selectedCoverFiles).length > 0)
  ));

  const handleSave = async () => {
    if (!post || !hasChanges || isSubmitting) return;

    const postText = description.trim() || title.trim();
    if (!postText) {
      toast.error('Please add a title or description.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Derived from the final text rather than from this session's dropdown picks, so removing a
      // mention persists as reliably as adding one.
      const mentionedUserIds = await resolveMentionedUserIds(postText, mentionedUsers);
      const coverPayload: Record<string, any> = {};
      const hasCustomCover = COVER_RATIOS.some(ratio => selectedCoverFiles[ratio]);

      if (post.type === 'photo') {
        coverPayload.thumbnailId = selectedPhotoCoverId || post.thumbnailId;
      } else if (hasCustomCover) {
        await Promise.all(COVER_RATIOS.map(async (ratio) => {
          const file = selectedCoverFiles[ratio];
          if (!file) return;
          const coverUpload = await uploadThumbnail(file);
          const fileId = coverUpload.fileId || coverUpload._id;
          if (!fileId) throw new Error('Cover upload completed without a file ID.');
          coverPayload[ratio === '4:3' ? 'cover4x3Id' : 'cover3x4Id'] = fileId;
        }));
      } else if (selectedCoverIndex !== null) {
        // Switching back to a generated cover has to clear any uploaded one, otherwise the stored id
        // and the stored URL would describe different images.
        coverPayload.coverThumbnailIndex = selectedCoverIndex;
        coverPayload.cover4x3Id = null;
        coverPayload.cover3x4Id = null;
      }

      await updatePost(post._id, {
        // Resent unchanged: the validator rejects a video post without files, and the media is not
        // editable here anyway.
        type: post.type,
        fileIds: post.fileIds,
        status: post.status,
        title: title.trim(),
        text: postText,
        ...(post.type === 'video' ? { coverDisplayRatio } : {}),
        // Both always sent: each is loaded with the post's current value and reflects the creator's
        // final intent, so an empty one means "cleared" rather than "not edited".
        topicKey: topicKey || null,
        mentionedUserIds,
        ...coverPayload
      });

      toast.success('Post updated successfully!');
      router.push('/creator/posts');
    } catch (error) {
      showErrorMessage(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const editable = isPostEditable(post);
  const graphicItems: GraphicFileItem[] = post?.type === 'photo'
    ? getPostImages(post).map(file => ({
      id: file._id,
      fileId: file._id,
      fileName: file.name || `image-${file._id}`,
      previewUrl: file.url,
      uploadState: 'uploaded'
    }))
    : [];

  return {
    post,
    isLoading,
    loadError,
    isEditable: editable,
    notEditableReason: post && !editable ? getPostNotEditableReason(post) : '',
    title,
    setTitle,
    description,
    setDescription,
    topicKey,
    setTopicKey,
    setMentionedUsers,
    descriptionEditorRef,
    videoPreviewUrl: post ? getPostVideo(post) : '',
    isGraphic,
    graphicItems,
    selectedPhotoCoverId,
    setSelectedPhotoCoverId,
    generatedCoverUrls,
    selectedCoverIndex,
    customCoverUrls,
    cover4x3PreviewUrl: customCoverUrls['4:3']
      || generatedCoverUrls[selectedCoverIndex ?? -1]
      || post?.cover4x3Url
      || '',
    cover3x4PreviewUrl: customCoverUrls['3:4']
      || generatedCoverUrls[selectedCoverIndex ?? -1]
      || post?.cover3x4Url
      || '',
    hasSelectedCover: selectedCoverIndex !== null || Object.keys(customCoverUrls).length > 0,
    coverDisplayRatio,
    setCoverDisplayRatio,
    isSubmitting,
    hasChanges,
    previewCaption: [title.trim(), description.trim()].filter(Boolean).join('\n'),
    handleCoverSelect,
    handleAiCoverSelect,
    handleCancel,
    handleSave
  };
}
