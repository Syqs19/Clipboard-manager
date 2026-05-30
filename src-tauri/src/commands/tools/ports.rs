//! Port Killer: elenca le porte TCP IPv4 in stato LISTEN con il PID proprietario
//! (GetExtendedTcpTable, TCP_TABLE_OWNER_PID_ALL), risolve il nome del processo
//! (OpenProcess + QueryFullProcessImageNameW) e permette di terminarlo
//! (OpenProcess PROCESS_TERMINATE + TerminateProcess).
//!
//! Solo IPv4 in questa versione (IPv6 via AF_INET6 come eventuale follow-up).
//! Tutto il codice `unsafe` è confinato e non fa panic: gli errori diventano
//! `AppError::msg`, i fallimenti nel risolvere il nome processo degradano a
//! "(unknown)" senza interrompere l'elenco.

use crate::error::{AppError, AppResult};

/// Una porta TCP in ascolto col processo che la possiede. Campi snake_case,
/// specchiati 1:1 in TS (`PortInfo`). `path` è il percorso completo
/// dell'eseguibile (per capire cos'è il processo); `is_system` segnala i
/// processi di Windows (eseguibile in C:\Windows o PID 0/4), così la UI può
/// nasconderli col filtro "Hide system processes".
#[derive(serde::Serialize)]
pub struct PortInfo {
    pub port: u16,
    pub pid: u32,
    /// nome del file eseguibile (es. "node.exe").
    pub process_name: String,
    /// nome leggibile del prodotto (FileDescription dell'exe, es. "Node.js");
    /// vuoto se l'exe non espone una descrizione → la UI mostra solo il file.
    pub display_name: String,
    pub path: String,
    pub is_system: bool,
    /// true se la porta è in ascolto su IPv6 (badge "IPv6" nella UI), false IPv4.
    pub ipv6: bool,
}

/// Elenca le porte TCP IPv4 in ascolto (stato LISTEN) con PID e nome processo,
/// ordinate per porta. Le porte non in ascolto (connessioni transitorie) sono
/// escluse: a un "port killer" interessano le porte su cui qualcosa è in bind.
#[tauri::command]
pub fn list_ports() -> AppResult<Vec<PortInfo>> {
    #[cfg(windows)]
    {
        windows_impl::list_ports()
    }
    #[cfg(not(windows))]
    {
        Err(AppError::msg("Port Killer is only available on Windows"))
    }
}

/// Termina il processo `pid` (PROCESS_TERMINATE + TerminateProcess). Rifiuta i
/// processi di sistema (0/4) e mappa ogni fallimento in `AppError::msg`.
#[tauri::command]
pub fn kill_process(pid: u32) -> AppResult<()> {
    if pid == 0 || pid == 4 {
        return Err(AppError::msg("Cannot terminate a system process"));
    }
    #[cfg(windows)]
    {
        windows_impl::kill_process(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Err(AppError::msg("Port Killer is only available on Windows"))
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{AppError, AppResult, PortInfo};
    use std::collections::{HashMap, HashSet};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID,
        MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    const AF_INET: u32 = 2; // IPv4
    const AF_INET6: u32 = 23; // IPv6
    const MIB_TCP_STATE_LISTEN: u32 = 2; // dwState == LISTEN
    const NO_ERROR: u32 = 0;

    pub fn list_ports() -> AppResult<Vec<PortInfo>> {
        // Raccogli le porte in ascolto su entrambe le famiglie: Vite/Node e molti
        // dev server fanno il bind su ::1 (IPv6), quindi senza v6 sarebbero invisibili.
        let mut listeners = collect_listeners(AF_INET, false)?;
        listeners.extend(collect_listeners(AF_INET6, true)?);

        // Snapshot di TUTTI i processi (nome exe) via Toolhelp: passa anche
        // senza pieni permessi, così i processi che OpenProcess non ci fa
        // aprire (servizi/sistema) hanno comunque almeno il nome.
        let names = process_names_snapshot();

        // dedup per (porta, pid, famiglia): se ascolta su entrambe le famiglie
        // mostriamo due righe (badge v4/v6), ma non duplichiamo la stessa.
        let mut seen: HashSet<(u16, u32, bool)> = HashSet::new();
        let mut out: Vec<PortInfo> = Vec::new();
        for (port, pid, ipv6) in listeners {
            if !seen.insert((port, pid, ipv6)) {
                continue;
            }
            // 1) prova col path completo (richiede permessi); 2) fallback al
            // nome dallo snapshot Toolhelp; 3) altrimenti "(unknown)".
            let (mut process_name, path) = process_info(pid);
            if path.is_empty() {
                if let Some(n) = names.get(&pid) {
                    process_name = n.clone();
                }
            }
            // "di sistema" = eseguibile in C:\Windows, PID speciali 0/4, oppure
            // path non risolvibile (accesso negato = processo che NON è tuo).
            let is_system = pid == 0
                || pid == 4
                || path.is_empty()
                || path.to_ascii_lowercase().starts_with("c:\\windows\\");
            // nome leggibile dalla FileDescription dell'exe (vuoto se assente).
            let display_name = if path.is_empty() {
                String::new()
            } else {
                file_description(&path)
            };
            out.push(PortInfo {
                port,
                pid,
                process_name,
                display_name,
                path,
                is_system,
                ipv6,
            });
        }
        // ordina per porta, poi IPv4 prima di IPv6 a parità di porta
        out.sort_by(|a, b| a.port.cmp(&b.port).then(a.ipv6.cmp(&b.ipv6)));
        Ok(out)
    }

    /// Raccoglie `(porta, pid, ipv6)` delle porte TCP in stato LISTEN per una
    /// famiglia (AF_INET o AF_INET6). Le due tabelle hanno layout identico per i
    /// campi che ci servono (dwLocalPort/dwState/dwOwningPid), cambia solo la
    /// dimensione della riga → leggiamo lo slice col tipo giusto in base a `ipv6`.
    fn collect_listeners(family: u32, ipv6: bool) -> AppResult<Vec<(u16, u32, bool)>> {
        // doppia chiamata: la prima con buffer nullo riempie `size`.
        let mut size: u32 = 0;
        unsafe {
            GetExtendedTcpTable(
                std::ptr::null_mut(),
                &mut size,
                0, // bOrder = FALSE
                family,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            );
        }
        if size == 0 {
            return Ok(Vec::new());
        }

        let mut buf: Vec<u8> = vec![0u8; size as usize];
        let ret = unsafe {
            GetExtendedTcpTable(
                buf.as_mut_ptr() as *mut core::ffi::c_void,
                &mut size,
                0,
                family,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            )
        };
        if ret != NO_ERROR {
            return Err(AppError::msg("Failed to query the TCP table"));
        }

        let mut out: Vec<(u16, u32, bool)> = Vec::new();
        unsafe {
            if ipv6 {
                let table = buf.as_ptr() as *const MIB_TCP6TABLE_OWNER_PID;
                let count = (*table).dwNumEntries as usize;
                let first = std::ptr::addr_of!((*table).table) as *const MIB_TCP6ROW_OWNER_PID;
                for r in std::slice::from_raw_parts(first, count) {
                    if r.dwState != MIB_TCP_STATE_LISTEN {
                        continue;
                    }
                    // dwLocalPort è in network byte order: i 2 byte bassi sono la porta.
                    out.push((u16::from_be((r.dwLocalPort & 0xFFFF) as u16), r.dwOwningPid, true));
                }
            } else {
                let table = buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
                let count = (*table).dwNumEntries as usize;
                let first = std::ptr::addr_of!((*table).table) as *const MIB_TCPROW_OWNER_PID;
                for r in std::slice::from_raw_parts(first, count) {
                    if r.dwState != MIB_TCP_STATE_LISTEN {
                        continue;
                    }
                    out.push((u16::from_be((r.dwLocalPort & 0xFFFF) as u16), r.dwOwningPid, false));
                }
            }
        }
        Ok(out)
    }

    /// Mappa `pid → nome eseguibile` di tutti i processi, via snapshot Toolhelp.
    /// Non richiede di aprire i singoli processi, quindi funziona anche per
    /// quelli che OpenProcess negherebbe (servizi/sistema). Vuota su errore.
    fn process_names_snapshot() -> HashMap<u32, String> {
        let mut map = HashMap::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return map;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    // szExeFile è terminato da NUL: prendi fino al primo zero.
                    let end = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
                    map.insert(entry.th32ProcessID, name);
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        map
    }

    /// Stringa UTF-16 NUL-terminata per le API W di Win32.
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Nome leggibile del prodotto = campo `FileDescription` delle version-info
    /// dell'exe (quello che il Task Manager mostra nella colonna "Nome").
    /// Best-effort: stringa vuota se il file non ha version-info o descrizione.
    fn file_description(path: &str) -> String {
        unsafe {
            let wpath = wide(path);
            // dimensione del blocco version-info; 0 = il file non ne ha.
            let mut handle: u32 = 0;
            let size = GetFileVersionInfoSizeW(wpath.as_ptr(), &mut handle);
            if size == 0 {
                return String::new();
            }
            let mut block: Vec<u8> = vec![0u8; size as usize];
            if GetFileVersionInfoW(
                wpath.as_ptr(),
                0,
                size,
                block.as_mut_ptr() as *mut core::ffi::c_void,
            ) == 0
            {
                return String::new();
            }

            // 1) leggi la prima traduzione disponibile (lang + codepage) da
            //    \VarFileInfo\Translation: una sequenza di coppie u16 (lang, cp).
            let mut tr_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
            let mut tr_len: u32 = 0;
            let tr_query = wide("\\VarFileInfo\\Translation");
            let (lang, cp) = if VerQueryValueW(
                block.as_ptr() as *const core::ffi::c_void,
                tr_query.as_ptr(),
                &mut tr_ptr,
                &mut tr_len,
            ) != 0
                && tr_len >= 4
                && !tr_ptr.is_null()
            {
                let pair = tr_ptr as *const u16;
                (*pair, *pair.add(1))
            } else {
                // fallback: inglese US + Unicode codepage (1200)
                (0x0409u16, 0x04b0u16)
            };

            // 2) interroga \StringFileInfo\<lang><cp>\FileDescription
            let sub = format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\FileDescription");
            let sub_w = wide(&sub);
            let mut val_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
            let mut val_len: u32 = 0;
            if VerQueryValueW(
                block.as_ptr() as *const core::ffi::c_void,
                sub_w.as_ptr(),
                &mut val_ptr,
                &mut val_len,
            ) == 0
                || val_ptr.is_null()
                || val_len == 0
            {
                return String::new();
            }
            // val_len è in caratteri (incluso il NUL finale); tronca al NUL.
            let chars = std::slice::from_raw_parts(val_ptr as *const u16, val_len as usize);
            let end = chars.iter().position(|&c| c == 0).unwrap_or(chars.len());
            String::from_utf16_lossy(&chars[..end]).trim().to_string()
        }
    }

    /// Best-effort: `(basename, percorso completo)` dell'eseguibile del processo.
    /// Mai errore (degrada a "(unknown)"); i PID di sistema 0/4 non sono apribili
    /// → etichetta fissa e path vuoto.
    fn process_info(pid: u32) -> (String, String) {
        if pid == 0 {
            return ("System Idle Process".to_string(), String::new());
        }
        if pid == 4 {
            return ("System".to_string(), String::new());
        }
        unsafe {
            let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return ("(unknown)".to_string(), String::new());
            }
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                buf.as_mut_ptr(),
                &mut len,
            );
            CloseHandle(handle);
            if ok == 0 || len == 0 {
                return ("(unknown)".to_string(), String::new());
            }
            let full = String::from_utf16_lossy(&buf[..len as usize]);
            // basename = ultimo componente del path
            let name = full.rsplit(['\\', '/']).next().unwrap_or(&full).to_string();
            (name, full)
        }
    }

    pub fn kill_process(pid: u32) -> AppResult<()> {
        unsafe {
            let handle: HANDLE = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if handle.is_null() {
                return Err(AppError::msg(
                    "Access denied or process not found — try running as administrator",
                ));
            }
            let ok = TerminateProcess(handle, 1);
            CloseHandle(handle);
            if ok == 0 {
                return Err(AppError::msg(format!("Failed to terminate process {pid}")));
            }
        }
        Ok(())
    }
}
