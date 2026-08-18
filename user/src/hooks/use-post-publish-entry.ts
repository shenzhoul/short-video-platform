'use client';

import { showErrorMessage } from '@lib/utils';
import { useProfile } from '@providers/profile.provider';
import { discardPhotoDrafts, discardVideoDraft } from '@services/post.service';
import {
  clearPostGraphicDraft,
  loadPostGraphicDraft,
  type PostGraphicDraft
} from '@services/post-graphic-draft.service';
import { setPendingPostPhotoFiles } from '@services/post-photo-handoff.service';
import {
  clearPostVideoDraft,
  loadPostVideoDraft,
  type PostVideoDraft
} from '@services/post-video-draft.service';
import { setPendingPostVideoFile } from '@services/post-video-handoff.service';
import { useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useState
} from 'react';
import { toast } from 'react-toastify';

export function usePostPublishEntry() {
  const router = useRouter();
  const { current, fetching: isProfileLoading } = useProfile();
  const [draft, setDraft] = useState<PostVideoDraft | null>(null);
  const [graphicDraft, setGraphicDraft] = useState<PostGraphicDraft | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isDiscardingGraphic, setIsDiscardingGraphic] = useState(false);

  useEffect(() => {
    if (isProfileLoading || !current?._id) return;
    setDraft(loadPostVideoDraft(current._id));
    setGraphicDraft(loadPostGraphicDraft(current._id));
  }, [current?._id, isProfileLoading]);

  const handleDiscardDraft = useCallback(async () => {
    if (!current?._id || !draft) return;

    setIsDiscarding(true);
    try {
      if (draft.fileId) await discardVideoDraft(draft.fileId);
      clearPostVideoDraft(current._id);
      setDraft(null);
      toast.success('Unpublished video discarded.');
    } catch (error) {
      showErrorMessage(error);
    } finally {
      setIsDiscarding(false);
    }
  }, [current?._id, draft]);

  const handleDiscardGraphicDraft = useCallback(async () => {
    if (!current?._id || !graphicDraft) return;
    setIsDiscardingGraphic(true);
    try {
      const fileIds = graphicDraft.items.map(item => item.fileId).filter((id): id is string => Boolean(id));
      if (fileIds.length) await discardPhotoDrafts(fileIds);
      clearPostGraphicDraft(current._id);
      setGraphicDraft(null);
      toast.success('Unpublished graphics discarded.');
    } catch (error) {
      showErrorMessage(error);
    } finally {
      setIsDiscardingGraphic(false);
    }
  }, [current?._id, graphicDraft]);

  const continueWithVideo = useCallback((file: File) => {
    setPendingPostVideoFile(file, draft?.fileId);
    router.push('/creator/publish/video?enter_from=publish_page');
  }, [draft?.fileId, router]);

  const handleVideoFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) continueWithVideo(file);
  }, [continueWithVideo]);

  const handleVideoDrop = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) continueWithVideo(file);
  }, [continueWithVideo]);

  const continueWithPhotos = useCallback((files: File[]) => {
    if (!files.length) return;
    const previousDraftFileIds = (graphicDraft?.items || [])
      .map(item => item.fileId)
      .filter((id): id is string => Boolean(id));
    setPendingPostPhotoFiles(files, previousDraftFileIds);
    router.push('/creator/publish/image?enter_from=publish_page');
  }, [graphicDraft?.items, router]);

  const handlePhotoFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    continueWithPhotos(files);
  }, [continueWithPhotos]);

  const handlePhotoDrop = useCallback((event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    continueWithPhotos(Array.from(event.dataTransfer.files || []));
  }, [continueWithPhotos]);

  const handleContinueDraft = useCallback(() => {
    router.push('/creator/publish/video?enter_from=draft');
  }, [router]);

  const handleContinueGraphicDraft = useCallback(() => {
    router.push('/creator/publish/image?enter_from=draft');
  }, [router]);

  return {
    draft,
    graphicDraft,
    isDiscarding,
    isDiscardingGraphic,
    handleContinueDraft,
    handleContinueGraphicDraft,
    handleDiscardDraft,
    handleDiscardGraphicDraft,
    handlePhotoDrop,
    handlePhotoFileChange,
    handleVideoDrop,
    handleVideoFileChange
  };
}
