import { useMemo, useCallback } from 'react';
import { useModules } from '@/core/contexts/ModuleContext';

interface ScreenPermission {
  screen_path: string;
  screen_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export function useScreenPermissions() {
  const { isAdmin, screenPermissions, accessLoading } = useModules();

  const screenPermissionsList = useMemo(() => {
    return Object.entries(screenPermissions).map(([path, perms]) => ({
      screen_path: path,
      screen_key: path,
      can_view: perms.view,
      can_create: perms.create,
      can_edit: perms.edit,
      can_delete: perms.delete,
    }));
  }, [screenPermissions]);

  const viewableScreenPaths = useMemo(() => {
    if (isAdmin) return new Set(['*']);
    return new Set(
      Object.entries(screenPermissions)
        .filter(([, p]) => p.view)
        .map(([path]) => path)
    );
  }, [screenPermissions, isAdmin]);

  const permissionsMap = useMemo(() => {
    const map: Record<string, ScreenPermission> = {};
    for (const [path, perms] of Object.entries(screenPermissions)) {
      map[path] = {
        screen_path: path,
        screen_key: path,
        can_view: perms.view,
        can_create: perms.create,
        can_edit: perms.edit,
        can_delete: perms.delete,
      };
    }
    return map;
  }, [screenPermissions]);

  const findPermissionForPath = useCallback((path: string): ScreenPermission | null => {
    if (permissionsMap[path]) return permissionsMap[path];
    const paramPattern = path.replace(/\/[0-9a-f-]{36}/g, '/:id').replace(/\/[0-9]+/g, '/:id');
    if (permissionsMap[paramPattern]) return permissionsMap[paramPattern];
    const segments = path.split('/');
    while (segments.length > 1) {
      segments.pop();
      const parent = segments.join('/') || '/';
      if (permissionsMap[parent]) return permissionsMap[parent];
    }
    return null;
  }, [permissionsMap]);

  const canViewScreen = useCallback((path: string): boolean => {
    if (isAdmin) return true;
    if (accessLoading) return false;
    const perm = findPermissionForPath(path);
    return perm?.can_view ?? false;
  }, [isAdmin, accessLoading, findPermissionForPath]);

  const getScreenPermission = useCallback((path: string): ScreenPermission | null => {
    if (isAdmin) {
      return {
        screen_path: path,
        screen_key: '',
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: true,
      };
    }
    return findPermissionForPath(path);
  }, [isAdmin, findPermissionForPath]);

  const getAllowedPaths = useCallback((): string[] => {
    if (isAdmin) return ['*'];
    return Object.entries(screenPermissions)
      .filter(([, p]) => p.view)
      .map(([path]) => path);
  }, [isAdmin, screenPermissions]);

  const refreshPermissions = useCallback(() => {
  }, []);

  return {
    isAdmin,
    isLoading: accessLoading,
    screenPermissions: screenPermissionsList,
    permissionsMap,
    viewableScreenPaths,
    canViewScreen,
    getScreenPermission,
    getAllowedPaths,
    refreshPermissions,
  };
}
