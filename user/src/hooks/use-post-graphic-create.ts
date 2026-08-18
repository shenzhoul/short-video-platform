'use client';

import { resolveMentionedUserIds } from '@lib/post-mentions';
import { showErrorMessage } from '@lib/utils';
import {
  create as createPost,
  discardPhotoDrafts,
  getPhotoDrafts,
  type PostPhotoDraftInfo,
  uploadPhoto
} from '@services/post.service';
import {
  clearPostGraphicDraft,
  loadPostGraphicDraft,
  type PostGraphicDraftItem,
  type PostGraphicDraftUploadState,
  savePostGraphicDraft } from '@services/post-graphic-draft.service';
import { consumePendingPostPhotoFiles } from '@services/post-photo-handoff.service';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

export const MAX_GRAPHIC_FILES = 12;
const MAX_GRAPHIC_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PARALLEL_GRAPHIC_UPLOADS = 3;
const SUPPORTED_GRAPHIC_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.raw'];
let graphicFileSequence = 0;

type PostGraphicCreateAccessState = 'checking' | 'allowed' | 'redirecting';

export interface GraphicFileItem {
  id: string;
  file?: File;
  fileId?: string;
  fileName: string;
  previewUrl: string;
  uploadState: PostGraphicDraftUploadState;
}

const isSupportedGraphic = (file: File) => (
  (file.type.startsWith('image/') && file.type !== 'image/gif')
  || SUPPORTED_GRAPHIC_EXTENSIONS.some(extension => file.name.toLowerCase().endsWith(extension))
);

const createGraphicItems = (files: File[], offset = 0): GraphicFileItem[] => files.map((file, index) => ({
  id: `${file.name}-${file.size}-${file.lastModified}-${offset + index}-${graphicFileSequence++}`,
  file,
  fileName: file.name,
  previewUrl: URL.createObjectURL(file),
  uploadState: 'preparing'
}));

const toPersistedItems = (items: GraphicFileItem[]): PostGraphicDraftItem[] => items.map(item => ({
  id: item.id,
  fileId: item.fileId,
  fileName: item.fileName,
  uploadState: item.uploadState
}));

const isTerminalDraftRestoreError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: number;
    statusCode?: number;
    details?: { code?: number };
  };
  const statusCode = candidate.details?.code ?? candidate.statusCode ?? candidate.code;
  return statusCode === 403 || statusCode === 404;
};

export function usePostGraphicCreate(userId: string) {
  const router = useRouter();
  const [handoff] = useState(() => consumePendingPostPhotoFiles());
  const [items, setItems] = useState<GraphicFileItem[]>(() => createGraphicItems(
    (handoff?.files || [])
      .filter(file => isSupportedGraphic(file) && file.size <= MAX_GRAPHIC_FILE_SIZE)
      .slice(0, MAX_GRAPHIC_FILES)
  ));
  const [accessState, setAccessState] = useState<PostGraphicCreateAccessState>(items.length ? 'allowed' : 'checking');
  const [draftHydrated, setDraftHydrated] = useState(Boolean(items.length));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topicKey, setTopicKey] = useState('');
  const [selectedCoverId, setSelectedCoverId] = useState(() => items[0]?.id || '');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadPercentage, setUploadPercentage] = useState(0);
  const descriptionEditorRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  const topicKeyRef = useRef(topicKey);
  const selectedCoverIdRef = useRef(selectedCoverId);
  const mountedRef = useRef(true);
  const removedItemIdsRef = useRef(new Set<string>());
  const uploadQueueRef = useRef<GraphicFileItem[]>([]);
  const activeUploadCountRef = useRef(0);
  const uploadProgressRef = useRef(new Map<string, number>());
  const processUploadQueueRef = useRef<() => void>(() => undefined);
  const initialUploadsStartedRef = useRef(false);
  const previousDraftDiscardStartedRef = useRef(false);
  const draftRestoreTerminalFailureRef = useRef(false);
  const interruptedFileIds = items
    .filter(item => item.uploadState === 'interrupted' && item.fileId)
    .map(item => item.fileId as string)
    .join('|');

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);

  useEffect(() => {
    topicKeyRef.current = topicKey;
  }, [topicKey]);

  useEffect(() => {
    selectedCoverIdRef.current = selectedCoverId;
  }, [selectedCoverId]);

  useEffect(() => () => {
    mountedRef.current = false;
    itemsRef.current.forEach(item => {
      if (item.file) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  const commitItems = useCallback((updater: (current: GraphicFileItem[]) => GraphicFileItem[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    if (mountedRef.current) setItems(next);
    return next;
  }, []);

  const persistDraft = useCallback((nextItems = itemsRef.current) => {
    if (!userId || !nextItems.length) return;
    savePostGraphicDraft(userId, {
      title: titleRef.current,
      description: descriptionRef.current,
      topicKey: topicKeyRef.current,
      selectedCoverId: selectedCoverIdRef.current || nextItems[0].id,
      items: toPersistedItems(nextItems)
    });
  }, [userId]);

  const discardFilesSilently = useCallback((fileIds: string[]) => {
    const uniqueFileIds = [...new Set(fileIds.filter(Boolean))];
    if (!uniqueFileIds.length) return;
    discardPhotoDrafts(uniqueFileIds).catch(() => {
      // The scheduled unused-file cleanup remains the fallback for editor-level replacement/removal.
    });
  }, []);

  const updateUploadProgress = useCallback(() => {
    const currentItems = itemsRef.current;
    if (!currentItems.length) return;
    const total = currentItems.reduce((sum, item) => (
      sum + (item.uploadState === 'uploaded' ? 100 : uploadProgressRef.current.get(item.id) || 0)
    ), 0);
    if (mountedRef.current) setUploadPercentage(Math.round(total / currentItems.length));
  }, []);

  const uploadGraphicItem = useCallback(async (item: GraphicFileItem) => {
    if (!item.file) return;
    try {
      const result = await uploadPhoto(
        item.file,
        progress => {
          uploadProgressRef.current.set(item.id, progress.percentage);
          updateUploadProgress();
        },
        prepared => {
          if (removedItemIdsRef.current.has(item.id)) {
            discardFilesSilently([prepared.fileId]);
            return;
          }

          const previousDraftFileIds = handoff?.previousDraftFileIds || [];
          if (previousDraftFileIds.length && !previousDraftDiscardStartedRef.current) {
            previousDraftDiscardStartedRef.current = true;
            discardFilesSilently(previousDraftFileIds);
          }
          const next = commitItems(current => current.map(currentItem => currentItem.id === item.id
            ? { ...currentItem, fileId: prepared.fileId, uploadState: 'uploading' }
            : currentItem));
          persistDraft(next);
        }
      );

      if (removedItemIdsRef.current.has(item.id)) {
        discardFilesSilently([result.fileId]);
        return;
      }

      uploadProgressRef.current.set(item.id, 100);
      const next = commitItems(current => current.map(currentItem => currentItem.id === item.id
        ? { ...currentItem, fileId: result.fileId, uploadState: 'uploaded' }
        : currentItem));
      persistDraft(next);
      updateUploadProgress();
    } catch (error) {
      const next = commitItems(current => current.map(currentItem => currentItem.id === item.id
        ? { ...currentItem, uploadState: 'failed' }
        : currentItem));
      persistDraft(next);
      showErrorMessage(error);
    }
  }, [commitItems, discardFilesSilently, handoff?.previousDraftFileIds, persistDraft, updateUploadProgress]);

  const processUploadQueue = useCallback(() => {
    while (activeUploadCountRef.current < MAX_PARALLEL_GRAPHIC_UPLOADS && uploadQueueRef.current.length) {
      const nextItem = uploadQueueRef.current.shift();
      if (!nextItem) break;
      if (removedItemIdsRef.current.has(nextItem.id)) continue;
      activeUploadCountRef.current += 1;
      if (mountedRef.current) setIsUploading(true);
      void uploadGraphicItem(nextItem).finally(() => {
        activeUploadCountRef.current -= 1;
        if (!activeUploadCountRef.current && !uploadQueueRef.current.length && mountedRef.current) {
          setIsUploading(false);
        }
        processUploadQueueRef.current();
      });
    }
    if (!activeUploadCountRef.current && !uploadQueueRef.current.length && mountedRef.current) {
      setIsUploading(false);
    }
  }, [uploadGraphicItem]);

  useEffect(() => {
    processUploadQueueRef.current = processUploadQueue;
  }, [processUploadQueue]);

  const enqueueUploads = useCallback((nextItems: GraphicFileItem[]) => {
    const uploadableItems = nextItems.filter(item => item.file && !removedItemIdsRef.current.has(item.id));
    if (!uploadableItems.length) return;
    uploadQueueRef.current.push(...uploadableItems);
    processUploadQueueRef.current();
  }, []);

  useEffect(() => {
    if (!userId || draftHydrated) return undefined;
    let isActive = true;
    const storedDraft = loadPostGraphicDraft(userId);
    const storedFileIds = [...new Set((storedDraft?.items || []).map(item => item.fileId).filter((id): id is string => Boolean(id)))];

    if (!storedDraft || !storedDraft.items.length) {
      setAccessState('redirecting');
      router.replace('/creator/publish?tab=uploadGraphic');
      setDraftHydrated(true);
      return undefined;
    }

    const applyRestoredDraft = (restoredItems: GraphicFileItem[]) => {
      itemsRef.current = restoredItems;
      setItems(restoredItems);
      setTitle(storedDraft.title);
      setDescription(storedDraft.description);
      setTopicKey(storedDraft.topicKey || '');
      setSelectedCoverId(restoredItems.some(item => item.id === storedDraft.selectedCoverId)
        ? storedDraft.selectedCoverId
        : restoredItems[0].id);
      setAccessState('allowed');
    };
    const interruptedItems: GraphicFileItem[] = storedDraft.items.map(item => ({
      id: item.id,
      fileId: item.fileId,
      fileName: item.fileName,
      previewUrl: '',
      uploadState: 'interrupted'
    }));
    const interruptedItemMap = new Map(interruptedItems.map(item => [item.id, item] as const));

    if (!storedFileIds.length) {
      applyRestoredDraft(interruptedItems);
      toast.info('The draft upload was interrupted. Replace the images to continue.');
      setDraftHydrated(true);
      return undefined;
    }

    getPhotoDrafts(storedFileIds)
      .then(({ data }) => {
        if (!isActive) return;
        const draftMap = new Map<string, PostPhotoDraftInfo>(data.map(draft => [draft.fileId, draft] as const));
        const restoredItems: GraphicFileItem[] = storedDraft.items.map(item => {
          const draft = item.fileId ? draftMap.get(item.fileId) : undefined;
          if (!draft) return interruptedItemMap.get(item.id) as GraphicFileItem;
          return {
            id: item.id,
            fileId: draft.fileId,
            fileName: draft.name || item.fileName,
            previewUrl: draft.url || '',
            uploadState: draft.url ? 'uploaded' : 'interrupted'
          };
        });
        applyRestoredDraft(restoredItems);
        if (restoredItems.some(item => item.uploadState === 'interrupted')) {
          toast.info('Some draft images are still processing. They can be replaced if processing does not finish.');
        }
      })
      .catch(error => {
        if (!isActive) return;
        draftRestoreTerminalFailureRef.current = isTerminalDraftRestoreError(error);
        applyRestoredDraft(interruptedItems);
        toast.error('The draft files could not be restored. Replace the images or discard the draft.');
      })
      .finally(() => {
        if (isActive) setDraftHydrated(true);
      });

    return () => {
      isActive = false;
    };
  }, [draftHydrated, router, userId]);

  useEffect(() => {
    if (!draftHydrated || accessState !== 'allowed' || !items.length) return undefined;
    if (handoff?.previousDraftFileIds.length && !previousDraftDiscardStartedRef.current) return undefined;
    const saveTimer = window.setTimeout(() => persistDraft(items), 250);
    return () => window.clearTimeout(saveTimer);
  }, [accessState, description, draftHydrated, handoff?.previousDraftFileIds.length, items, persistDraft, selectedCoverId, title, topicKey]);

  useEffect(() => {
    if (!draftHydrated || !handoff?.files.length || initialUploadsStartedRef.current || !items.length) return;
    initialUploadsStartedRef.current = true;
    if (!handoff.previousDraftFileIds.length) persistDraft(items);
    enqueueUploads(items);
  }, [draftHydrated, enqueueUploads, handoff?.files.length, handoff?.previousDraftFileIds.length, items, persistDraft]);

  useEffect(() => {
    if (!draftHydrated || !interruptedFileIds || draftRestoreTerminalFailureRef.current) return undefined;
    const fileIds = interruptedFileIds.split('|');
    let active = true;
    let attempts = 0;
    const timer = { id: 0 };
    const poll = async () => {
      attempts += 1;
      try {
        const { data } = await getPhotoDrafts(fileIds);
        if (!active) return;
        const urlMap = new Map(data.filter(draft => draft.url).map(draft => [draft.fileId, draft.url as string] as const));
        if (urlMap.size) {
          const next = commitItems(current => current.map(item => item.fileId && urlMap.has(item.fileId)
            ? { ...item, previewUrl: urlMap.get(item.fileId) as string, uploadState: 'uploaded' }
            : item));
          persistDraft(next);
        }
      } catch (error) {
        // Keep the interrupted state; the creator can replace or discard the item.
        if (isTerminalDraftRestoreError(error)) {
          draftRestoreTerminalFailureRef.current = true;
          window.clearInterval(timer.id);
        }
      }
      if (attempts >= 30) window.clearInterval(timer.id);
    };
    timer.id = window.setInterval(() => void poll(), 1500);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer.id);
    };
  }, [commitItems, draftHydrated, interruptedFileIds, persistDraft]);

  const validateFiles = useCallback((files: File[]) => {
    const unsupported = files.filter(file => !isSupportedGraphic(file));
    const oversized = files.filter(file => isSupportedGraphic(file) && file.size > MAX_GRAPHIC_FILE_SIZE);
    if (unsupported.length) toast.error('Only supported image files can be added. GIF is not supported.');
    if (oversized.length) toast.error('Each image must be 50MB or smaller.');
    return files.filter(file => isSupportedGraphic(file) && file.size <= MAX_GRAPHIC_FILE_SIZE);
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const valid = validateFiles(files);
    if (!valid.length) return;
    const remaining = MAX_GRAPHIC_FILES - itemsRef.current.length;
    if (valid.length > remaining) toast.info(`A graphic post supports up to ${MAX_GRAPHIC_FILES} images.`);
    const addedItems = createGraphicItems(valid.slice(0, remaining), itemsRef.current.length);
    if (!addedItems.length) return;
    const next = commitItems(current => [...current, ...addedItems]);
    if (!selectedCoverIdRef.current) {
      selectedCoverIdRef.current = next[0].id;
      setSelectedCoverId(next[0].id);
    }
    persistDraft(next);
    enqueueUploads(addedItems);
  }, [commitItems, enqueueUploads, persistDraft, validateFiles]);

  const removeItem = useCallback((id: string) => {
    const removed = itemsRef.current.find(item => item.id === id);
    if (!removed) return;
    removedItemIdsRef.current.add(id);
    if (removed.file) URL.revokeObjectURL(removed.previewUrl);
    const next = commitItems(current => current.filter(item => item.id !== id));
    if (selectedCoverIdRef.current === id) {
      const nextCoverId = next[0]?.id || '';
      selectedCoverIdRef.current = nextCoverId;
      setSelectedCoverId(nextCoverId);
    }
    if (removed.fileId) discardFilesSilently([removed.fileId]);
    persistDraft(next);
  }, [commitItems, discardFilesSilently, persistDraft]);

  const replaceItem = useCallback((id: string, file: File) => {
    const [validFile] = validateFiles([file]);
    if (!validFile) return;
    const replaced = itemsRef.current.find(item => item.id === id);
    if (!replaced) return;
    const [replacement] = createGraphicItems([validFile]);
    removedItemIdsRef.current.add(id);
    if (replaced.file) URL.revokeObjectURL(replaced.previewUrl);
    const next = commitItems(current => current.map(item => item.id === id ? replacement : item));
    if (selectedCoverIdRef.current === id) {
      selectedCoverIdRef.current = replacement.id;
      setSelectedCoverId(replacement.id);
    }
    if (replaced.fileId) discardFilesSilently([replaced.fileId]);
    persistDraft(next);
    enqueueUploads([replacement]);
  }, [commitItems, discardFilesSilently, enqueueUploads, persistDraft, validateFiles]);

  const reorderItems = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const next = commitItems(current => {
      const sourceIndex = current.findIndex(item => item.id === sourceId);
      const targetIndex = current.findIndex(item => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const reordered = [...current];
      const [movedItem] = reordered.splice(sourceIndex, 1);
      reordered.splice(targetIndex, 0, movedItem);
      return reordered;
    });
    persistDraft(next);
  }, [commitItems, persistDraft]);

  const replaceFiles = useCallback((files: File[]) => {
    const valid = validateFiles(files);
    if (!valid.length) return;
    if (valid.length > MAX_GRAPHIC_FILES) toast.info(`A graphic post supports up to ${MAX_GRAPHIC_FILES} images.`);
    const previousItems = itemsRef.current;
    previousItems.forEach(item => {
      removedItemIdsRef.current.add(item.id);
      if (item.file) URL.revokeObjectURL(item.previewUrl);
    });
    discardFilesSilently(previousItems.map(item => item.fileId).filter((id): id is string => Boolean(id)));
    const next = createGraphicItems(valid.slice(0, MAX_GRAPHIC_FILES));
    commitItems(() => next);
    selectedCoverIdRef.current = next[0].id;
    setSelectedCoverId(next[0].id);
    persistDraft(next);
    enqueueUploads(next);
  }, [commitItems, discardFilesSilently, enqueueUploads, persistDraft, validateFiles]);

  const handlePost = useCallback(async () => {
    const currentItems = itemsRef.current;
    if (!currentItems.length) {
      toast.error('Please add at least one image before posting.');
      return;
    }
    if (isUploading || currentItems.some(item => item.uploadState !== 'uploaded' || !item.fileId)) {
      toast.error('Wait for every image to finish uploading or replace interrupted images.');
      return;
    }
    const postText = description.trim() || title.trim();
    if (!postText) {
      toast.error('Please add a title or description.');
      return;
    }

    setIsSubmitting(true);
    try {
      const fileIds = currentItems.map(item => item.fileId as string);
      const selectedCover = currentItems.find(item => item.id === selectedCoverId) || currentItems[0];
      // Resolved from the final text so a photo post carries the same mentions a
      // video post does; without this, naming someone in a photo caption stored
      // nothing and silently notified nobody.
      const mentionedUserIds = await resolveMentionedUserIds(postText);

      await createPost({
        title: title.trim(),
        text: postText,
        type: 'photo',
        status: 'active',
        fileIds,
        thumbnailId: selectedCover.fileId,
        ...(topicKey ? { topicKey } : {}),
        ...(mentionedUserIds.length ? { mentionedUserIds } : {})
      });
      clearPostGraphicDraft(userId);
      toast.success('Graphic post created successfully!');
      router.push('/');
    } catch (error) {
      showErrorMessage(error);
    } finally {
      setIsSubmitting(false);
    }
  }, [description, isUploading, router, selectedCoverId, title, topicKey, userId]);

  return {
    canAccessCreatePage: accessState === 'allowed' && Boolean(items.length),
    title,
    setTitle,
    description,
    setDescription,
    topicKey,
    setTopicKey,
    descriptionEditorRef,
    items,
    selectedCoverId,
    setSelectedCoverId,
    isUploading,
    isSubmitting,
    uploadPercentage,
    previewCaption: [title.trim(), description.trim()].filter(Boolean).join('\n'),
    addFiles,
    removeItem,
    replaceItem,
    reorderItems,
    replaceFiles,
    handlePost
  };
}
