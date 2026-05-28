// File System Access API helpers.
// Сейчас используется только для tag-list-пикера в AppHeader.

function isFileSystemAccessSupported() {
    return (
        typeof window !== 'undefined' &&
        window.showDirectoryPicker &&
        window.showOpenFilePicker
    );
}

/**
 * Резолвит startIn-параметр для showOpenFilePicker. Если передан file-handle —
 * пытается достать его родительскую директорию (приятнее открывать picker
 * именно там, а не файл уже выделенным).
 */
async function resolveStartInForOpenFilePicker(handle) {
    if (!handle) return null;
    if (handle.kind === 'directory') return handle;
    const dir = await getFileDirectory(handle);
    return dir ?? handle;
}

export async function getFileDirectory(fileHandle) {
    try {
        const root = await navigator.storage.getDirectory();
        const path = await root.resolve(fileHandle);

        if (!path || path.length === 0) {
            return null;
        }

        let currentHandle = root;
        for (let i = 0; i < path.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(path[i]);
        }
        return currentHandle;
    } catch (e) {
        console.warn('getFileDirectory failed:', e);
        return null;
    }
}

export async function selectFile(startInHandle = null) {
    if (!isFileSystemAccessSupported()) {
        throw new Error('Браузер не поддерживает File System Access API');
    }

    const options = { multiple: false };
    const resolved = await resolveStartInForOpenFilePicker(startInHandle);
    if (resolved) {
        try {
            await resolved.queryPermission({ mode: 'read' });
            options.startIn = resolved;
        } catch {
            options.startIn = resolved;
        }
    }

    try {
        const [fileHandle] = await window.showOpenFilePicker(options);
        return fileHandle;
    } catch (e) {
        if (e.name === 'AbortError') {
            return null;
        }
        throw e;
    }
}

export async function getFileContentFromHandle(fileHandle) {
    try {
        const file = await fileHandle.getFile();
        return await file.text();
    } catch (e) {
        console.error("Ошибка чтения файла:", e);
        return null;
    }
}