'use client';

import type { IUser } from '@interfaces/user';
import { resolveMentionedUserIds } from '@lib/post-mentions';
import { showErrorMessage } from '@lib/utils';
import {
  create as createPost,
  discardVideoDraft,
  getVideoDraft,
  uploadThumbnail
} from '@services/post.service';
import {
  clearPostVideoDraft,
  loadPostVideoDraft,
  type PostVideoDraftUploadState,
  savePostVideoDraft
} from '@services/post-video-draft.service';
import { consumePendingPostVideoFile } from '@services/post-video-handoff.service';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { toast } from 'react-toastify';

type PostCreateAccessState = 'checking' | 'allowed' | 'redirecting';
export type PostCoverRatio = '4:3' | '3:4';

export function usePostCreate(userId: string) {
  const router = useRouter();
  const [videoHandoff] = useState(() => consumePendingPostVideoFile());
  const [accessState, setAccessState] = useState<PostCreateAccessState>(
    videoHandoff?.file ? 'allowed' : 'checking'
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // Optional content category. Empty string means the creator chose "No topic".
  const [topicKey, setTopicKey] = useState('');
  // Users picked from the @ dropdown, so their ids can be submitted alongside the text.
  const [mentionedUsers, setMentionedUsers] = useState<IUser[]>([]);
  const [videoFileId, setVideoFileId] = useState<string | null>(null);
  const [draftFileId, setDraftFileId] = useState<string | null>(
    videoHandoff?.previousDraftFileId || null
  );
  const [draftFileName, setDraftFileName] = useState('');
  const [draftUploadState, setDraftUploadState] = useState<PostVideoDraftUploadState>('preparing');
  const [draftStarted, setDraftStarted] = useState(false);
  const [restoredPreviewUrl, setRestoredPreviewUrl] = useState('');
  const [coverVideoPreviewUrl, setCoverVideoPreviewUrl] = useState('');
  const [generatedCoverUrls, setGeneratedCoverUrls] = useState<string[]>([]);
  const [selectedCoverFiles, setSelectedCoverFiles] = useState<Partial<Record<PostCoverRatio, File>>>({});
  const [customCoverUrls, setCustomCoverUrls] = useState<Partial<Record<PostCoverRatio, string>>>({});
  const [uploadedCoverFileIds, setUploadedCoverFileIds] = useState<Partial<Record<PostCoverRatio, string>>>({});
  const [selectedCoverIndex, setSelectedCoverIndex] = useState<number | null>(null);
  const [coverDisplayRatio, setCoverDisplayRatio] = useState<PostCoverRatio>('4:3');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const descriptionEditorRef = useRef<HTMLDivElement>(null);
  const hydratedUserIdRef = useRef('');
  const draftFileIdRef = useRef<string | null>(videoHandoff?.previousDraftFileId || null);
  const customCoverUrlsRef = useRef(customCoverUrls);

  useEffect(() => {
    draftFileIdRef.current = draftFileId;
  }, [draftFileId]);

  useEffect(() => {
    customCoverUrlsRef.current = customCoverUrls;
  }, [customCoverUrls]);

  useEffect(() => () => {
    Object.values(customCoverUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!userId || hydratedUserIdRef.current === userId) return;
    hydratedUserIdRef.current = userId;

    const storedDraft = loadPostVideoDraft(userId);
    if (!videoHandoff?.file && !storedDraft?.fileId) {
      setAccessState('redirecting');
      router.replace('/creator/publish');
      return;
    }

    setAccessState('allowed');
    if (!storedDraft) return;

    setDraftStarted(true);
    setTitle(storedDraft.title);
    setDescription(storedDraft.description);
    setDraftFileId(storedDraft.fileId || null);
    setDraftFileName(storedDraft.fileName || '');
    setDraftUploadState(storedDraft.uploadState);

    if (!storedDraft.fileId) return;
    let isActive = true;

    getVideoDraft(storedDraft.fileId)
      .then(({ data }) => {
        if (!isActive) return;

        setDraftFileName(data.name || storedDraft.fileName || '');
        setGeneratedCoverUrls(data.thumbnails?.slice(0, 3) || []);
        if (data.url) {
          setVideoFileId(data.fileId);
          setRestoredPreviewUrl(data.url);
          setCoverVideoPreviewUrl(data.url);
          setDraftUploadState('uploaded');
        } else {
          setVideoFileId(null);
          setDraftUploadState('interrupted');
          toast.info('Your draft was restored. Select the video again to continue the interrupted upload.');
        }
      })
      .catch(() => {
        if (!isActive) return;
        setVideoFileId(null);
        setRestoredPreviewUrl('');
        setDraftUploadState('interrupted');
      });

    return () => {
      isActive = false;
    };
  }, [router, userId, videoHandoff?.file]);

  useEffect(() => {
    if (!draftStarted || !userId) return undefined;

    const saveTimer = window.setTimeout(() => {
      savePostVideoDraft(userId, {
        title,
        description,
        fileId: draftFileId || undefined,
        fileName: draftFileName || undefined,
        uploadState: draftUploadState
      });
    }, 250);

    return () => window.clearTimeout(saveTimer);
  }, [
    description,
    draftFileId,
    draftFileName,
    draftStarted,
    draftUploadState,
    title,
    userId
  ]);

  const handleUploadStart = useCallback((fileName: string) => {
    setDraftStarted(true);
    setDraftFileName(fileName);
    setDraftUploadState('preparing');
    setVideoFileId(null);
    setRestoredPreviewUrl('');
    setGeneratedCoverUrls([]);
    Object.values(customCoverUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
    setCustomCoverUrls({});
    setSelectedCoverFiles({});
    setUploadedCoverFileIds({});
    setSelectedCoverIndex(null);
    setCoverDisplayRatio('4:3');

    if (userId) {
      savePostVideoDraft(userId, {
        title,
        description,
        fileId: draftFileIdRef.current || undefined,
        fileName,
        uploadState: 'preparing'
      });
    }
  }, [description, title, userId]);

  const handleUploadPrepared = useCallback((fileId: string, fileName: string) => {
    const previousFileId = draftFileIdRef.current;
    setDraftFileId(fileId);
    setDraftFileName(fileName);
    setDraftUploadState('uploading');

    if (userId) {
      savePostVideoDraft(userId, {
        title,
        description,
        fileId,
        fileName,
        uploadState: 'uploading'
      });
    }

    if (previousFileId && previousFileId !== fileId) {
      discardVideoDraft(previousFileId).catch(() => {
        // The periodic unused-file cleanup remains the fallback.
      });
    }
  }, [description, title, userId]);

  const handleUploadComplete = useCallback((fileId: string) => {
    setDraftFileId(fileId);
    setVideoFileId(fileId);
    setDraftUploadState('uploaded');
  }, []);

  useEffect(() => {
    if (!videoFileId || generatedCoverUrls.length >= 3) return undefined;

    let isActive = true;
    let attempts = 0;
    const timer = { id: 0 };
    const loadGeneratedCovers = async () => {
      attempts += 1;
      try {
        const { data } = await getVideoDraft(videoFileId);
        if (!isActive) return;
        const thumbnails = data.thumbnails?.slice(0, 3) || [];
        if (thumbnails.length) setGeneratedCoverUrls(thumbnails);
        if (thumbnails.length >= 3 || data.processingStatus === 'failed' || attempts >= 30) {
          window.clearInterval(timer.id);
        }
      } catch {
        if (attempts >= 30) window.clearInterval(timer.id);
      }
    };
    timer.id = window.setInterval(() => void loadGeneratedCovers(), 1500);
    void loadGeneratedCovers();

    return () => {
      isActive = false;
      window.clearInterval(timer.id);
    };
  }, [generatedCoverUrls.length, videoFileId]);

  const handleUploadInterrupted = useCallback((state: 'interrupted' | 'failed') => {
    setVideoFileId(null);
    setDraftUploadState(state);
  }, []);

  const handleCoverSelect = useCallback((ratio: PostCoverRatio, file: File) => {
    setCustomCoverUrls(current => {
      if (current[ratio]) URL.revokeObjectURL(current[ratio]);
      return { ...current, [ratio]: URL.createObjectURL(file) };
    });
    setSelectedCoverFiles(current => ({ ...current, [ratio]: file }));
    setUploadedCoverFileIds(current => ({ ...current, [ratio]: undefined }));
  }, []);

  const handleAiCoverSelect = useCallback((index: number) => {
    Object.values(customCoverUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
    setCustomCoverUrls({});
    setSelectedCoverIndex(index);
    setSelectedCoverFiles({});
    setUploadedCoverFileIds({});
  }, []);

  const handlePost = async () => {
    if (isUploading) {
      toast.info('Please wait for the video upload to finish.');
      return;
    }
    if (!videoFileId) {
      toast.error('Please upload a video before posting.');
      return;
    }

    const postText = description.trim() || title.trim();
    if (!postText) {
      toast.error('Please add a title or description.');
      return;
    }

    const hasBothCustomCovers = (['4:3', '3:4'] as PostCoverRatio[]).every(
      ratio => selectedCoverFiles[ratio] || uploadedCoverFileIds[ratio]
    );
    const effectiveCoverIndex = selectedCoverIndex ?? 0;
    if (!generatedCoverUrls[effectiveCoverIndex] && !hasBothCustomCovers) {
      toast.info('Please wait for the video covers to finish generating.');
      return;
    }

    setIsSubmitting(true);
    try {
      const nextCoverIds = { ...uploadedCoverFileIds };
      await Promise.all((['4:3', '3:4'] as PostCoverRatio[]).map(async (ratio) => {
        const file = selectedCoverFiles[ratio];
        if (!file || nextCoverIds[ratio]) return;
        const coverUpload = await uploadThumbnail(file);
        const fileId = coverUpload.fileId || coverUpload._id;
        if (!fileId) throw new Error('Cover upload completed without a file ID.');
        nextCoverIds[ratio] = fileId;
      }));
      setUploadedCoverFileIds(nextCoverIds);

      // The submitted text is the source of truth for who is mentioned, so a
      // handle deleted before publishing takes its id with it. Dropdown picks are
      // passed as hints so the common path resolves without extra lookups, and
      // the server re-verifies whatever arrives.
      const mentionedUserIds = await resolveMentionedUserIds(postText, mentionedUsers);

      await createPost({
        title: title.trim(),
        text: postText,
        type: 'video',
        status: 'active',
        fileIds: [videoFileId],
        cover4x3Id: nextCoverIds['4:3'],
        cover3x4Id: nextCoverIds['3:4'],
        coverThumbnailIndex: effectiveCoverIndex,
        coverDisplayRatio,
        // Omitted entirely when unset so the payload never carries an empty topic.
        ...(topicKey ? { topicKey } : {}),
        ...(mentionedUserIds.length ? { mentionedUserIds } : {})
      });
      if (userId) clearPostVideoDraft(userId);
      toast.success('Post created successfully!');
      router.push('/');
    } catch (error) {
      showErrorMessage(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    canAccessCreatePage: accessState === 'allowed',
    isCheckingAccess: accessState === 'checking',
    title,
    setTitle,
    description,
    setDescription,
    topicKey,
    setTopicKey,
    setMentionedUsers,
    descriptionEditorRef,
    restoredPreviewUrl,
    initialUploadFile: videoHandoff?.file,
    generatedCoverUrls,
    cover4x3PreviewUrl: customCoverUrls['4:3'] || generatedCoverUrls[selectedCoverIndex ?? 0] || generatedCoverUrls[0] || '',
    cover3x4PreviewUrl: customCoverUrls['3:4'] || generatedCoverUrls[selectedCoverIndex ?? 0] || generatedCoverUrls[0] || '',
    customCoverUrls,
    selectedCoverIndex,
    hasSelectedCover: selectedCoverIndex !== null || Object.keys(customCoverUrls).length > 0,
    coverDisplayRatio,
    setCoverDisplayRatio,
    coverVideoPreviewUrl,
    setCoverVideoPreviewUrl,
    isUploading,
    setIsUploading,
    isSubmitting,
    previewCaption: [title.trim(), description.trim()].filter(Boolean).join('\n'),
    handleUploadStart,
    handleUploadPrepared,
    handleUploadComplete,
    handleUploadInterrupted,
    handleCoverSelect,
    handleAiCoverSelect,
    handlePost
  };
}
