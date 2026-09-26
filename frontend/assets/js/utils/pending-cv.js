window.PendingCvStore = (() => {
    const databaseName = 'synovae-pending-cv';
    const storeName = 'files';

    function openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(storeName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function save(file) {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, 'readwrite');
            transaction.objectStore(storeName).put({
                blob: file,
                name: file.name,
                type: file.type
            }, 'landing-cv');
            transaction.oncomplete = () => {
                database.close();
                resolve();
            };
            transaction.onerror = () => {
                database.close();
                reject(transaction.error);
            };
        });
    }

    async function take() {
        const database = await openDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.get('landing-cv');
            request.onsuccess = () => {
                const pending = request.result;
                if (pending) store.delete('landing-cv');
                transaction.oncomplete = () => {
                    database.close();
                    resolve(pending ? new File([pending.blob], pending.name, { type: pending.type }) : null);
                };
            };
            request.onerror = () => {
                database.close();
                reject(request.error);
            };
        });
    }

    return { save, take };
})();
