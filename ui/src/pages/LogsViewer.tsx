import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Badge, Box, Button, Collapse, Flex, HStack, Icon, IconButton,
  Input, InputGroup, InputLeftElement, NumberInput, NumberInputField,
  Select, Spinner, Switch, Text, Tooltip, VStack, Tag, TagLabel, TagCloseButton,
  useColorModeValue, useToast,
} from '@chakra-ui/react';
import {
  FaSearch, FaSync, FaChevronDown, FaChevronUp, FaExclamationTriangle,
  FaClock, FaUser, FaRobot, FaGlobe, FaLink, FaArrowLeft, FaTimes,
  FaFilter, FaCopy, FaCode, FaFileAlt, FaStream, FaServer, FaHeartbeat,
  FaBolt, FaChartLine, FaShieldAlt, FaCheckCircle, FaTimesCircle,
  FaTag, FaHistory, FaDownload,
} from 'react-icons/fa';
import ReactMarkdown from 'react-markdown';
import { useSearchParams } from '../hooks/useSearchParams';
import { useDebounce } from '../hooks/useDebounce';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogEntry {
  level: string;
  time: string;
  msg: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;
  userId?: string;
  chatModelId?: string;
  organizationId?: string;
  err?: { message: string; stack: string };
  [key: string]: unknown;
}

interface RequestGroup {
  requestId: string;
  method: string;
  path: string;
  statusCode: number | null;
  duration: number | null;
  userId: string | null;
  chatModelId: string | null;
  organizationId: string | null;
  ip: string | null;
  startTime: string;
  logCount: number;
  hasError: boolean;
  entries: LogEntry[];
}

interface GroupedResponse { mode: 'grouped'; groups: RequestGroup[]; total: number; page: number; pages: number; }
interface TraceResponse { mode: 'trace'; requestId: string; entries: LogEntry[]; total: number; }

interface AuditLogRow {
  id: number;
  timestamp: string;
  log_type: string;
  status: string;
  details: string | null;
  error_message: string | null;
  user_id: string | null;
  entity_id: string | null;
  tags: string | null;
  source: string;
}

interface AuditLogsResponse { logs: AuditLogRow[]; total: number; page: number; pages: number; }

interface ReportStats {
  totalRequests: number;
  totalErrors: number;
  totalWarnings: number;
  errorRate: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  uniqueUsers: number;
  uniqueIPs: number;
  statusCodeDistribution: Record<string, number>;
  requestsPerHour: Record<string, number>;
  errorsPerHour: Record<string, number>;
  kumaStatus: {
    name: string; url?: string; type: string; currentStatus: string;
    uptime24h: number; avgPing: number; incidents: number;
  }[];
  errorClusters: number;
  slowestEndpoints: { path: string; avgDuration: number; count: number }[];
  topErrorPaths: { path: string; count: number; statusCodes: number[] }[];
}

// ---------------------------------------------------------------------------
// Helpers & Constants
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<string, string> = { debug: 'gray', info: 'blue', warn: 'orange', error: 'red', fatal: 'purple' };
const METHOD_COLORS: Record<string, string> = { GET: 'green', POST: 'blue', PUT: 'orange', PATCH: 'yellow', DELETE: 'red', OPTIONS: 'gray' };
const STATUS_COLORS: Record<string, string> = { SUCCESS: 'green', FAILURE: 'red', PENDING: 'yellow', WARNING: 'orange' };

function statusColor(code: number | null): string {
  if (!code) return 'gray';
  if (code >= 500) return 'red';
  if (code >= 400) return 'orange';
  if (code >= 300) return 'yellow';
  return 'green';
}

function durationColor(ms: number | null): string | undefined {
  if (ms == null) return undefined;
  if (ms > 2000) return 'red.400';
  if (ms > 1000) return 'orange.400';
  if (ms > 500) return 'yellow.500';
  return undefined;
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return iso; }
}

function formatTimeMs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
  } catch { return iso; }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortPath(p: string, maxLen = 50): string {
  const clean = p.split('?')[0];
  if (clean.length <= maxLen) return clean;
  return '...' + clean.slice(-maxLen + 3);
}

function parseTags(tagsStr: string | null): Record<string, string> {
  if (!tagsStr) return {};
  try { return JSON.parse(tagsStr); } catch { return {}; }
}

// ---------------------------------------------------------------------------
// Shared UI: card backgrounds
// ---------------------------------------------------------------------------

function useCardStyles() {
  return {
    cardBg: useColorModeValue('white', 'rgba(255,255,255,0.03)'),
    borderColor: useColorModeValue('rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)'),
    hoverBg: useColorModeValue('gray.50', 'rgba(255,255,255,0.04)'),
    mutedText: useColorModeValue('gray.500', 'gray.400'),
    codeBg: useColorModeValue('gray.50', 'rgba(255,255,255,0.02)'),
  };
}

// ---------------------------------------------------------------------------
// JsonLine
// ---------------------------------------------------------------------------

const JsonLine: React.FC<{ k: string; v: unknown; onCopy: (text: string) => void }> = ({ k, v, onCopy }) => {
  const keyColor = useColorModeValue('purple.600', 'purple.300');
  const stringColor = useColorModeValue('green.700', 'green.300');
  const numberColor = useColorModeValue('blue.600', 'blue.300');
  const nullColor = useColorModeValue('gray.400', 'gray.500');
  const boolColor = useColorModeValue('orange.600', 'orange.300');
  const hoverBg = useColorModeValue('blackAlpha.50', 'whiteAlpha.50');

  const isObj = v !== null && typeof v === 'object';
  const display = isObj ? JSON.stringify(v, null, 2) : String(v);
  const valueColor = v === null || v === undefined ? nullColor
    : typeof v === 'string' ? stringColor
    : typeof v === 'number' ? numberColor
    : typeof v === 'boolean' ? boolColor : undefined;

  return (
    <Flex align="start" gap={1} py={0.5} role="group" _hover={{ bg: hoverBg }} px={1} borderRadius="sm">
      <Text color={keyColor} flexShrink={0} fontWeight="600">{k}:</Text>
      <Text color={valueColor} whiteSpace={isObj ? 'pre-wrap' : 'pre'} wordBreak="break-all" flex={1}>
        {typeof v === 'string' ? `"${display}"` : display}
      </Text>
      <IconButton
        aria-label="Copy value" icon={<FaCopy />} size="xs" variant="ghost"
        opacity={0} _groupHover={{ opacity: 0.6 }} _hover={{ opacity: 1 }}
        minW="auto" h="auto" p={0.5}
        onClick={(e) => { e.stopPropagation(); onCopy(isObj ? JSON.stringify(v, null, 2) : String(v)); }}
        flexShrink={0}
      />
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// InnerLogEntry
// ---------------------------------------------------------------------------

const InnerLogEntry: React.FC<{ entry: LogEntry; isLast: boolean }> = ({ entry, isLast }) => {
  const [showFull, setShowFull] = useState(false);
  const { borderColor, codeBg, mutedText } = useCardStyles();
  const errorBg = useColorModeValue('red.50', 'rgba(254,178,178,0.06)');
  const toast = useToast();

  const isBookend = entry.msg === 'request started' || entry.msg === 'request completed';
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', status: 'info', duration: 1000 });
  }, [toast]);

  const importantKeys = ['msg', 'level', 'time', 'method', 'path', 'statusCode', 'duration', 'err'];
  const contextKeys = ['requestId', 'userId', 'chatModelId', 'organizationId', 'ip', 'userAgent', 'pmId'];
  const otherKeys = Object.keys(entry).filter(k => !importantKeys.includes(k) && !contextKeys.includes(k) && entry[k] !== undefined);
  const activeContextKeys = contextKeys.filter(k => entry[k] !== undefined);

  return (
    <Box borderBottomWidth={isLast ? 0 : '1px'} borderColor={borderColor} py={1.5} px={4} fontSize="xs" opacity={isBookend ? 0.5 : 1}>
      <Flex align="center" gap={3} cursor="pointer" onClick={() => setShowFull(!showFull)}>
        <Text fontFamily="mono" color={mutedText} whiteSpace="nowrap" w="90px" flexShrink={0}>{formatTimeMs(entry.time)}</Text>
        <Badge colorScheme={LEVEL_COLORS[entry.level] || 'gray'} fontSize="9px" textTransform="uppercase" flexShrink={0} w="45px" textAlign="center" borderRadius="full">{entry.level}</Badge>
        <Text flex={1} isTruncated>{entry.msg}</Text>
        {entry.err && <Icon as={FaExclamationTriangle} color="red.400" w={3} h={3} flexShrink={0} />}
        <Icon as={showFull ? FaChevronUp : FaCode} w={3} h={3} color={mutedText} flexShrink={0} opacity={0.4} />
      </Flex>
      <Collapse in={showFull} animateOpacity>
        <Box mt={2} p={3} bg={codeBg} borderRadius="12px" fontFamily="mono" fontSize="11px" overflowX="auto" maxH="400px" overflowY="auto">
          <Flex justify="end" mb={2} gap={2}>
            <Tooltip label="Copy full JSON">
              <IconButton aria-label="Copy full payload" icon={<FaCopy />} size="xs" variant="outline" borderRadius="8px"
                onClick={(e) => { e.stopPropagation(); copyToClipboard(JSON.stringify(entry, null, 2)); }} />
            </Tooltip>
          </Flex>
          {entry.err && (
            <Box mb={3} p={2} bg={errorBg} borderRadius="10px" borderLeftWidth="3px" borderLeftColor="red.400">
              <Flex justify="space-between" align="start">
                <Text color="red.500" fontWeight="700" mb={1}>{entry.err.message}</Text>
                <IconButton aria-label="Copy error" icon={<FaCopy />} size="xs" variant="ghost"
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(`${entry.err!.message}\n${entry.err!.stack}`); }} />
              </Flex>
              {entry.err.stack && <Text whiteSpace="pre-wrap" opacity={0.8} fontSize="10px">{entry.err.stack}</Text>}
            </Box>
          )}
          {activeContextKeys.length > 0 && (
            <Box mb={2} pb={2} borderBottomWidth="1px" borderColor={borderColor}>
              {activeContextKeys.map(k => <JsonLine key={k} k={k} v={entry[k]} onCopy={copyToClipboard} />)}
            </Box>
          )}
          {otherKeys.map(k => <JsonLine key={k} k={k} v={entry[k]} onCopy={copyToClipboard} />)}
        </Box>
      </Collapse>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// RequestBlock
// ---------------------------------------------------------------------------

const RequestBlock: React.FC<{
  group: RequestGroup; isExpanded: boolean;
  onToggle: () => void; onCopyLink: () => void;
  onFilterBy: (key: string, value: string) => void;
}> = ({ group, isExpanded, onToggle, onCopyLink, onFilterBy }) => {
  const { cardBg, borderColor, mutedText, codeBg } = useCardStyles();
  const headerHoverBg = useColorModeValue('gray.50', 'rgba(255,255,255,0.03)');

  const leftBorderColor = group.hasError ? 'red.400'
    : group.statusCode && group.statusCode >= 500 ? 'red.400'
    : group.statusCode && group.statusCode >= 400 ? 'orange.400' : 'green.400';

  return (
    <Box bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="16px" overflow="hidden" borderLeftWidth="3px" borderLeftColor={leftBorderColor}>
      <Flex align="center" px={4} py={3} cursor="pointer" _hover={{ bg: headerHoverBg }} onClick={onToggle} gap={3} transition="background 0.15s">
        <Icon as={isExpanded ? FaChevronUp : FaChevronDown} w={3} h={3} color={mutedText} flexShrink={0} />
        <Text fontFamily="mono" fontSize="xs" color={mutedText} w="65px" flexShrink={0}>{formatTime(group.startTime)}</Text>
        {group.method && (
          <Badge colorScheme={METHOD_COLORS[group.method] || 'gray'} fontSize="10px" variant="subtle" flexShrink={0} w="55px" textAlign="center" borderRadius="full">{group.method}</Badge>
        )}
        <Text fontFamily="mono" fontSize="xs" flex={1} isTruncated fontWeight="500">{shortPath(group.path)}</Text>
        {group.statusCode && <Badge colorScheme={statusColor(group.statusCode)} fontSize="10px" borderRadius="full" flexShrink={0}>{group.statusCode}</Badge>}
        <Text fontFamily="mono" fontSize="xs" fontWeight="600" color={durationColor(group.duration)} w="55px" textAlign="right" flexShrink={0}>{formatDuration(group.duration)}</Text>
        <Tooltip label={`${group.logCount} log entries`}>
          <Badge variant="outline" fontSize="10px" colorScheme={group.logCount > 10 ? 'orange' : 'gray'} borderRadius="full" flexShrink={0}>{group.logCount}</Badge>
        </Tooltip>
        <HStack spacing={1} flexShrink={0} display={{ base: 'none', lg: 'flex' }}>
          {group.userId && (
            <Tooltip label={`Filter by user: ${group.userId}`}>
              <Badge variant="outline" fontSize="9px" colorScheme="cyan" cursor="pointer" borderRadius="full"
                _hover={{ bg: useColorModeValue('cyan.50', 'rgba(0,255,255,0.06)') }}
                onClick={(e) => { e.stopPropagation(); onFilterBy('userId', group.userId!); }}>
                <Flex align="center" gap={1}><Icon as={FaUser} w={2} h={2} />{group.userId.slice(0, 8)}</Flex>
              </Badge>
            </Tooltip>
          )}
          {group.chatModelId && (
            <Tooltip label={`Filter by chatModel: ${group.chatModelId}`}>
              <Badge variant="outline" fontSize="9px" colorScheme="purple" cursor="pointer" borderRadius="full"
                _hover={{ bg: useColorModeValue('purple.50', 'rgba(128,0,255,0.06)') }}
                onClick={(e) => { e.stopPropagation(); onFilterBy('chatModelId', group.chatModelId!); }}>
                <Flex align="center" gap={1}><Icon as={FaRobot} w={2} h={2} />{group.chatModelId.slice(0, 8)}</Flex>
              </Badge>
            </Tooltip>
          )}
        </HStack>
        <Tooltip label="Copy link">
          <IconButton aria-label="Copy link" icon={<FaLink />} size="xs" variant="ghost" borderRadius="8px"
            onClick={(e) => { e.stopPropagation(); onCopyLink(); }} flexShrink={0} />
        </Tooltip>
        {group.hasError && <Icon as={FaExclamationTriangle} color="red.400" w={3.5} h={3.5} flexShrink={0} />}
      </Flex>

      <Collapse in={isExpanded} animateOpacity>
        <Box bg={codeBg} borderTopWidth="1px" borderColor={borderColor}>
          <Flex px={4} py={2} gap={4} fontSize="xs" color={mutedText} flexWrap="wrap">
            <HStack spacing={1} cursor={group.ip ? 'pointer' : undefined} _hover={group.ip ? { color: 'blue.400' } : undefined}
              onClick={group.ip ? (e) => { e.stopPropagation(); onFilterBy('ip', group.ip!); } : undefined}>
              <Icon as={FaGlobe} w={3} h={3} /><Text fontFamily="mono">{group.ip || '-'}</Text>
            </HStack>
            <Text fontFamily="mono">rid: {group.requestId}</Text>
            {group.userId && <Text fontFamily="mono" cursor="pointer" _hover={{ color: 'cyan.400' }} onClick={(e) => { e.stopPropagation(); onFilterBy('userId', group.userId!); }}>uid: {group.userId}</Text>}
            {group.chatModelId && <Text fontFamily="mono" cursor="pointer" _hover={{ color: 'purple.400' }} onClick={(e) => { e.stopPropagation(); onFilterBy('chatModelId', group.chatModelId!); }}>cm: {group.chatModelId}</Text>}
            {group.organizationId && <Text fontFamily="mono" cursor="pointer" _hover={{ color: 'orange.400' }} onClick={(e) => { e.stopPropagation(); onFilterBy('organizationId', group.organizationId!); }}>org: {group.organizationId}</Text>}
          </Flex>
          {group.entries.map((entry, idx) => (
            <InnerLogEntry key={idx} entry={entry} isLast={idx === group.entries.length - 1} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// AuditLogRow Component
// ---------------------------------------------------------------------------

const AuditLogBlock: React.FC<{
  log: AuditLogRow; isExpanded: boolean;
  onToggle: () => void; onTagClick: (key: string, value: string) => void;
}> = ({ log, isExpanded, onToggle, onTagClick }) => {
  const { cardBg, borderColor, mutedText, codeBg } = useCardStyles();
  const headerHoverBg = useColorModeValue('gray.50', 'rgba(255,255,255,0.03)');
  const toast = useToast();
  const tags = parseTags(log.tags);
  const details = log.details ? (() => { try { return JSON.parse(log.details!); } catch { return log.details; } })() : null;
  const isError = log.status === 'FAILURE';
  const leftColor = isError ? 'red.400' : log.status === 'WARNING' ? 'orange.400' : 'green.400';

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied', status: 'info', duration: 1000 });
  }, [toast]);

  return (
    <Box bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="16px" overflow="hidden" borderLeftWidth="3px" borderLeftColor={leftColor}>
      <Flex align="center" px={4} py={3} cursor="pointer" _hover={{ bg: headerHoverBg }} onClick={onToggle} gap={3} transition="background 0.15s">
        <Icon as={isExpanded ? FaChevronUp : FaChevronDown} w={3} h={3} color={mutedText} flexShrink={0} />
        <Text fontFamily="mono" fontSize="xs" color={mutedText} w="120px" flexShrink={0}>{formatDateTime(log.timestamp)}</Text>
        <Badge
          colorScheme={STATUS_COLORS[log.status] || 'gray'} fontSize="9px"
          textTransform="uppercase" flexShrink={0} borderRadius="full" px={2}
        >{log.status}</Badge>
        <Text fontSize="xs" fontWeight="600" flex={1} isTruncated fontFamily="mono">{log.log_type}</Text>
        {log.user_id && (
          <Tooltip label={`User: ${log.user_id}`}>
            <Badge variant="outline" fontSize="9px" colorScheme="cyan" borderRadius="full" flexShrink={0}>
              <Flex align="center" gap={1}><Icon as={FaUser} w={2} h={2} />{log.user_id.slice(0, 8)}</Flex>
            </Badge>
          </Tooltip>
        )}
        {Object.keys(tags).length > 0 && (
          <Tooltip label={Object.entries(tags).map(([k, v]) => `${k}: ${v}`).join(', ')}>
            <Badge variant="outline" fontSize="9px" colorScheme="purple" borderRadius="full" flexShrink={0}>
              <Flex align="center" gap={1}><Icon as={FaTag} w={2} h={2} />{Object.keys(tags).length}</Flex>
            </Badge>
          </Tooltip>
        )}
        {isError && <Icon as={FaExclamationTriangle} color="red.400" w={3.5} h={3.5} flexShrink={0} />}
      </Flex>

      <Collapse in={isExpanded} animateOpacity>
        <Box bg={codeBg} borderTopWidth="1px" borderColor={borderColor} p={4} fontSize="xs">
          {/* Tags */}
          {Object.keys(tags).length > 0 && (
            <Flex gap={2} mb={3} flexWrap="wrap">
              {Object.entries(tags).map(([k, v]) => (
                <Tag
                  key={k} size="sm" colorScheme="purple" variant="subtle"
                  borderRadius="full" cursor="pointer"
                  _hover={{ opacity: 0.8 }}
                  onClick={() => onTagClick(k, v)}
                >
                  <TagLabel fontFamily="mono" fontSize="10px">{k}: {v}</TagLabel>
                </Tag>
              ))}
            </Flex>
          )}

          {/* Error message */}
          {log.error_message && (
            <Box mb={3} p={3} bg={useColorModeValue('red.50', 'rgba(254,178,178,0.06)')} borderRadius="10px" borderLeftWidth="3px" borderLeftColor="red.400">
              <Flex justify="space-between" align="start">
                <Text color="red.500" fontWeight="600" fontFamily="mono">{log.error_message}</Text>
                <IconButton aria-label="Copy" icon={<FaCopy />} size="xs" variant="ghost"
                  onClick={() => copyToClipboard(log.error_message!)} />
              </Flex>
            </Box>
          )}

          {/* Details */}
          {details && (
            <Box fontFamily="mono" fontSize="11px">
              <Flex justify="space-between" align="center" mb={2}>
                <Text fontWeight="600" color={mutedText} textTransform="uppercase" fontSize="10px" letterSpacing="0.05em">Details</Text>
                <IconButton aria-label="Copy details" icon={<FaCopy />} size="xs" variant="ghost"
                  onClick={() => copyToClipboard(typeof details === 'string' ? details : JSON.stringify(details, null, 2))} />
              </Flex>
              {typeof details === 'object'
                ? Object.entries(details).map(([k, v]) => <JsonLine key={k} k={k} v={v} onCopy={copyToClipboard} />)
                : <Text whiteSpace="pre-wrap">{String(details)}</Text>
              }
            </Box>
          )}

          {/* Meta */}
          <Flex gap={4} mt={3} pt={3} borderTopWidth="1px" borderColor={borderColor} color={mutedText} fontFamily="mono" fontSize="10px" flexWrap="wrap">
            <Text>id: {log.id}</Text>
            <Text>source: {log.source}</Text>
            {log.user_id && <Text>user: {log.user_id}</Text>}
          </Flex>
        </Box>
      </Collapse>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

const StatCard: React.FC<{
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; trend?: 'good' | 'warning' | 'critical';
}> = ({ label, value, sub, icon: IconComp, color, trend }) => {
  const cardBg = useColorModeValue('white', 'rgba(255,255,255,0.03)');
  const borderColor = useColorModeValue('rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)');
  const labelColor = useColorModeValue('gray.500', 'gray.400');
  const valueColor = useColorModeValue('gray.900', 'white');
  const trendBg = trend === 'critical' ? 'red.50' : trend === 'warning' ? 'orange.50' : 'green.50';
  const trendBgDark = trend === 'critical' ? 'rgba(254,178,178,0.06)' : trend === 'warning' ? 'rgba(251,211,141,0.06)' : 'rgba(154,230,180,0.06)';
  const bg = useColorModeValue(trend ? trendBg : cardBg, trend ? trendBgDark : cardBg);

  return (
    <Box bg={bg} borderWidth="1px" borderColor={borderColor} borderRadius="16px" p={4} position="relative" overflow="hidden" transition="all 0.2s" _hover={{ transform: 'translateY(-1px)', boxShadow: 'sm' }}>
      <Flex align="center" gap={3}>
        <Flex align="center" justify="center" w="40px" h="40px" borderRadius="12px"
          bg={useColorModeValue(`${color}.50`, 'rgba(255,255,255,0.06)')} flexShrink={0}>
          <Icon as={IconComp} w={4} h={4} color={`${color}.500`} />
        </Flex>
        <Box flex={1} minW={0}>
          <Text fontSize="11px" fontWeight="600" color={labelColor} textTransform="uppercase" letterSpacing="0.05em">{label}</Text>
          <Text fontSize="22px" fontWeight="700" color={valueColor} lineHeight="1.2" isTruncated>{value}</Text>
          {sub && <Text fontSize="11px" color={labelColor} mt={0.5}>{sub}</Text>}
        </Box>
      </Flex>
    </Box>
  );
};

// ---------------------------------------------------------------------------
// KumaStatusRow
// ---------------------------------------------------------------------------

const KumaStatusRow: React.FC<{ monitor: ReportStats['kumaStatus'][0]; isLast: boolean }> = ({ monitor, isLast }) => {
  const { borderColor, mutedText } = useCardStyles();
  const textColor = useColorModeValue('gray.700', 'gray.200');
  const sc = monitor.currentStatus === 'up' ? 'green' : monitor.currentStatus === 'down' ? 'red' : 'orange';

  return (
    <Flex align="center" gap={3} py={3} px={4} borderBottomWidth={isLast ? 0 : '1px'} borderColor={borderColor}>
      <Box w="8px" h="8px" borderRadius="full" bg={`${sc}.400`} boxShadow={`0 0 6px var(--chakra-colors-${sc}-400)`} flexShrink={0} />
      <Box flex={1} minW={0}>
        <Text fontSize="13px" fontWeight="500" color={textColor} isTruncated>{monitor.name}</Text>
        {monitor.url && <Text fontSize="11px" color={mutedText} fontFamily="mono" isTruncated>{monitor.url}</Text>}
      </Box>
      <HStack spacing={3} flexShrink={0}>
        <Tooltip label="Uptime 24h">
          <Badge colorScheme={monitor.uptime24h >= 99.9 ? 'green' : monitor.uptime24h >= 99 ? 'yellow' : 'red'} fontSize="10px" borderRadius="full" px={2}>{monitor.uptime24h.toFixed(2)}%</Badge>
        </Tooltip>
        <Tooltip label="Avg ping"><Text fontSize="11px" color={mutedText} fontFamily="mono">{monitor.avgPing}ms</Text></Tooltip>
        {monitor.incidents > 0 && (
          <Tooltip label={`${monitor.incidents} incident(s)`}>
            <Badge colorScheme="red" fontSize="10px" variant="subtle" borderRadius="full">{monitor.incidents} inc.</Badge>
          </Tooltip>
        )}
      </HStack>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// AIReportContent
// ---------------------------------------------------------------------------

const AIReportContent: React.FC<{ apiKey: string; projectId: string | null }> = ({ apiKey, projectId }) => {
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markdownRef = useRef<HTMLDivElement>(null);
  const { cardBg, borderColor, codeBg, mutedText } = useCardStyles();
  const errorBoxBg = useColorModeValue('red.50', 'rgba(254,178,178,0.06)');

  const generateReport = useCallback(() => {
    setIsGenerating(true); setIsComplete(false); setMarkdown(''); setStats(null); setError(null);
    const qs = new URLSearchParams({ apiKey });
    if (projectId) qs.set('projectId', projectId);

    const evtSource = new EventSource(`/api/logs/report?${qs.toString()}`);
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'stats') setStats(data.data);
        else if (data.type === 'token') setMarkdown(prev => prev + data.content);
        else if (data.type === 'error') { setError(data.message); setIsGenerating(false); evtSource.close(); }
        else if (data.type === 'done') { setIsGenerating(false); setIsComplete(true); evtSource.close(); }
      } catch { /* skip */ }
    };
    evtSource.onerror = () => { setIsGenerating(false); setError('Connection lost'); evtSource.close(); };
    return () => evtSource.close();
  }, [apiKey, projectId]);

  useEffect(() => {
    if (isGenerating && markdownRef.current) markdownRef.current.scrollTop = markdownRef.current.scrollHeight;
  }, [markdown, isGenerating]);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <VStack spacing={5} align="stretch">
      <Flex justify="space-between" align="center" wrap="wrap" gap={3}>
        <VStack align="start" spacing={0}>
          <Text fontSize="xl" fontWeight="700">AI Report</Text>
          <Text fontSize="sm" color={mutedText}>{today}</Text>
        </VStack>
        <Button size="sm" colorScheme={isGenerating ? 'gray' : 'brand'}
          leftIcon={isGenerating ? <Spinner size="xs" /> : <FaBolt />}
          onClick={generateReport} isDisabled={isGenerating} borderRadius="12px" px={5}>
          {isGenerating ? 'Analyse en cours...' : isComplete ? 'Regenerer' : 'Generer le rapport'}
        </Button>
      </Flex>

      {stats && (
        <Box bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="20px" p={{ base: 4, md: 6 }}>
          <HStack spacing={2} mb={4}>
            <Icon as={FaChartLine} w={4} h={4} color={mutedText} />
            <Text fontSize="12px" fontWeight="600" color={mutedText} textTransform="uppercase" letterSpacing="0.05em">Metriques du jour</Text>
          </HStack>
          <Box display="grid" gridTemplateColumns={{ base: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(5, 1fr)' }} gap={3}>
            <StatCard label="Requetes" value={stats.totalRequests.toLocaleString()} icon={FaStream} color="blue" />
            <StatCard label="Erreurs" value={stats.totalErrors} sub={`${stats.errorRate}% du trafic`} icon={FaExclamationTriangle} color="red" trend={stats.errorRate > 5 ? 'critical' : stats.errorRate > 1 ? 'warning' : 'good'} />
            <StatCard label="Warnings" value={stats.totalWarnings} icon={FaClock} color="orange" />
            <StatCard label="Temps moyen" value={`${stats.avgResponseTime}ms`} sub={`P95: ${stats.p95ResponseTime}ms`} icon={FaBolt} color="purple" trend={stats.p95ResponseTime > 3000 ? 'critical' : stats.p95ResponseTime > 1500 ? 'warning' : 'good'} />
            <StatCard label="Utilisateurs" value={stats.uniqueUsers} sub={`${stats.uniqueIPs} IPs`} icon={FaUser} color="cyan" />
          </Box>
        </Box>
      )}

      {stats && stats.kumaStatus.length > 0 && (
        <Box bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="20px" overflow="hidden">
          <Flex align="center" gap={2} px={6} pt={5} pb={3}>
            <Icon as={FaHeartbeat} w={4} h={4} color={mutedText} />
            <Text fontSize="12px" fontWeight="600" color={mutedText} textTransform="uppercase" letterSpacing="0.05em">Infrastructure</Text>
            {stats.kumaStatus.every(m => m.currentStatus === 'up') ? (
              <Badge colorScheme="green" fontSize="10px" borderRadius="full" ml={2}>
                <Flex align="center" gap={1}><Icon as={FaCheckCircle} w={2.5} h={2.5} />All systems operational</Flex>
              </Badge>
            ) : (
              <Badge colorScheme="red" fontSize="10px" borderRadius="full" ml={2}>
                <Flex align="center" gap={1}><Icon as={FaTimesCircle} w={2.5} h={2.5} />Issues detected</Flex>
              </Badge>
            )}
          </Flex>
          {stats.kumaStatus.map((m, i) => <KumaStatusRow key={i} monitor={m} isLast={i === stats.kumaStatus.length - 1} />)}
        </Box>
      )}

      {(markdown || isGenerating) && (
        <Box bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="20px" overflow="hidden">
          <Flex align="center" gap={2} px={6} pt={5} pb={3}>
            <Icon as={FaShieldAlt} w={4} h={4} color={mutedText} />
            <Text fontSize="12px" fontWeight="600" color={mutedText} textTransform="uppercase" letterSpacing="0.05em">Analyse IA</Text>
            {isGenerating && <HStack spacing={2} ml={2}><Spinner size="xs" color="brand.400" /><Text fontSize="11px" color="brand.400" fontWeight="500">Streaming...</Text></HStack>}
            {isComplete && <Badge colorScheme="green" fontSize="10px" borderRadius="full" ml={2}>Termine</Badge>}
          </Flex>
          <Box ref={markdownRef} px={6} pb={6} maxH="70vh" overflowY="auto"
            sx={{
              '& h1': { fontSize: 'xl', fontWeight: '700', mt: 6, mb: 3, borderBottomWidth: '1px', borderColor, pb: 2 },
              '& h2': { fontSize: 'lg', fontWeight: '700', mt: 5, mb: 2 },
              '& h3': { fontSize: 'md', fontWeight: '600', mt: 4, mb: 2 },
              '& p': { mb: 3, lineHeight: '1.7', fontSize: '14px' },
              '& ul, & ol': { pl: 6, mb: 3 },
              '& li': { mb: 1.5, fontSize: '14px', lineHeight: '1.6' },
              '& code': { bg: codeBg, px: 1.5, py: 0.5, borderRadius: 'md', fontSize: '13px', fontFamily: 'mono' },
              '& pre': { bg: codeBg, p: 4, borderRadius: 'lg', overflowX: 'auto', mb: 3, fontSize: '13px' },
              '& pre code': { bg: 'transparent', p: 0 },
              '& blockquote': { borderLeftWidth: '3px', borderLeftColor: 'brand.400', pl: 4, ml: 0, mb: 3, fontStyle: 'italic', color: mutedText },
              '& table': { w: '100%', mb: 4, borderCollapse: 'collapse' },
              '& th': { bg: codeBg, fontWeight: '600', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', px: 3, py: 2, textAlign: 'left', borderBottomWidth: '2px', borderColor },
              '& td': { px: 3, py: 2, fontSize: '13px', borderBottomWidth: '1px', borderColor },
              '& strong': { fontWeight: '600' },
              '& hr': { my: 5, borderColor },
            }}>
            <ReactMarkdown>{markdown}</ReactMarkdown>
            {isGenerating && (
              <Box as="span" display="inline-block" w="2px" h="18px" bg="brand.400" ml={0.5}
                animation="blink 1s step-end infinite" verticalAlign="text-bottom"
                sx={{ '@keyframes blink': { '50%': { opacity: 0 } } }} />
            )}
          </Box>
        </Box>
      )}

      {!stats && !isGenerating && !error && (
        <Flex direction="column" align="center" justify="center" py={16} borderWidth="1px" borderColor={borderColor} borderRadius="20px" borderStyle="dashed">
          <Icon as={FaFileAlt} w={10} h={10} color={mutedText} mb={4} opacity={0.3} />
          <Text fontSize="md" fontWeight="500" color={mutedText} mb={1}>Aucun rapport genere</Text>
          <Text fontSize="sm" color={mutedText} mb={5} textAlign="center" maxW="400px">
            Cliquez sur &laquo; Generer le rapport &raquo; pour lancer une analyse IA des dernieres 24h.
          </Text>
          <Button size="sm" colorScheme="brand" leftIcon={<FaBolt />} onClick={generateReport} borderRadius="12px" px={5}>Generer le rapport</Button>
        </Flex>
      )}

      {error && (
        <Box bg={errorBoxBg} borderWidth="1px" borderColor="red.200" borderRadius="16px" p={5}>
          <Flex align="center" gap={3}>
            <Icon as={FaExclamationTriangle} color="red.500" />
            <Text fontSize="sm" color="red.600" fontWeight="500">{error}</Text>
          </Flex>
        </Box>
      )}
    </VStack>
  );
};

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

const Pagination: React.FC<{
  currentPage: number; totalPages: number; totalItems: number;
  itemsPerPage: number; onPageChange: (page: number) => void;
  onItemsPerPageChange: (perPage: number) => void; isLoading?: boolean;
}> = ({ currentPage, totalPages, totalItems, itemsPerPage, onPageChange, onItemsPerPageChange, isLoading }) => {
  const mutedText = useColorModeValue('gray.500', 'gray.400');
  if (totalPages <= 1 && totalItems <= 25) return null;

  return (
    <Flex justify="space-between" align="center" wrap="wrap" gap={3} opacity={isLoading ? 0.5 : 1}>
      <Text fontSize="sm" color={mutedText}>{totalItems.toLocaleString()} items</Text>
      <HStack spacing={2}>
        <Button size="xs" variant="outline" borderRadius="8px" onClick={() => onPageChange(currentPage - 1)} isDisabled={currentPage <= 1}>Prev</Button>
        <Text fontSize="sm" fontFamily="mono">{currentPage} / {totalPages}</Text>
        <Button size="xs" variant="outline" borderRadius="8px" onClick={() => onPageChange(currentPage + 1)} isDisabled={currentPage >= totalPages}>Next</Button>
      </HStack>
      <Select size="xs" w="100px" borderRadius="8px" value={itemsPerPage} onChange={(e) => onItemsPerPageChange(Number(e.target.value))}>
        {[25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
      </Select>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// Main LogsViewer
// ---------------------------------------------------------------------------

type TabType = 'requests' | 'audit' | 'report';

const LogsViewer: React.FC<{ apiKey: string; projectId: string | null }> = ({ apiKey, projectId }) => {
  const { get, update, clear } = useSearchParams();

  const tabParam = get('tab');
  const [activeTab, setActiveTab] = useState<TabType>(
    tabParam === 'audit' ? 'audit' : tabParam === 'report' ? 'report' : 'requests'
  );

  // === Request logs state ===
  const [groups, setGroups] = useState<RequestGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [traceData, setTraceData] = useState<{ mode: 'trace'; requestId: string; entries: LogEntry[]; total: number } | null>(null);

  // === Audit logs state ===
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPages, setAuditPages] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditExpandedId, setAuditExpandedId] = useState<number | null>(null);
  const [tagKeys, setTagKeys] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<Record<string, string>>({});

  // URL-derived filters (shared)
  const search = get('search');
  const level = get('level');
  const method = get('method');
  const minDuration = get('minDuration');
  const onlyErrors = get('onlyErrors') === 'true';
  const statusCodeFilter = get('statusCode');
  const pathFilter = get('path');
  const chatModelId = get('chatModelId');
  const userId = get('userId');
  const organizationId = get('organizationId');
  const ipFilter = get('ip');
  const requestIdParam = get('requestId');
  const pageFromUrl = Math.max(1, parseInt(get('page') || '1', 10));
  const limitFromUrl = Math.max(1, parseInt(get('limit') || '50', 10));

  // Audit-specific filters
  const auditLogType = get('logType');
  const auditStatus = get('auditStatus');
  const auditSearch = get('auditSearch');

  // Local input state for debounced fields
  const [searchInput, setSearchInput] = useState(search);
  const [pathInput, setPathInput] = useState(pathFilter);
  const [minDurationInput, setMinDurationInput] = useState(minDuration);
  const [chatModelIdInput, setChatModelIdInput] = useState(chatModelId);
  const [userIdInput, setUserIdInput] = useState(userId);
  const [orgIdInput, setOrgIdInput] = useState(organizationId);
  const [ipInput, setIpInput] = useState(ipFilter);
  const [auditSearchInput, setAuditSearchInput] = useState(auditSearch);

  const debouncedSearch = useDebounce(searchInput, 400);
  const debouncedPath = useDebounce(pathInput, 400);
  const debouncedMinDuration = useDebounce(minDurationInput, 600);
  const debouncedChatModelId = useDebounce(chatModelIdInput, 400);
  const debouncedUserId = useDebounce(userIdInput, 400);
  const debouncedOrgId = useDebounce(orgIdInput, 400);
  const debouncedIp = useDebounce(ipInput, 400);
  const debouncedAuditSearch = useDebounce(auditSearchInput, 400);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toast = useToast();
  const { cardBg, borderColor, mutedText, codeBg } = useCardStyles();
  const overlayBg = useColorModeValue('whiteAlpha.700', 'blackAlpha.500');
  const tabBg = useColorModeValue('gray.100', 'rgba(255,255,255,0.04)');
  const activeTabBg = useColorModeValue('white', 'rgba(255,255,255,0.10)');
  const activeTabColor = useColorModeValue('gray.900', 'white');
  const inactiveTabColor = useColorModeValue('gray.500', 'gray.400');
  const hoverTabBg = useColorModeValue('gray.200', 'rgba(255,255,255,0.06)');
  const filterBg = cardBg;

  // Debounce sync → URL
  useEffect(() => { if (debouncedSearch !== search) update({ search: debouncedSearch || undefined }); }, [debouncedSearch]);
  useEffect(() => { if (debouncedPath !== pathFilter) update({ path: debouncedPath || undefined }); }, [debouncedPath]);
  useEffect(() => { if (debouncedMinDuration !== minDuration) update({ minDuration: debouncedMinDuration || undefined }); }, [debouncedMinDuration]);
  useEffect(() => { if (debouncedChatModelId !== chatModelId) update({ chatModelId: debouncedChatModelId || undefined }); }, [debouncedChatModelId]);
  useEffect(() => { if (debouncedUserId !== userId) update({ userId: debouncedUserId || undefined }); }, [debouncedUserId]);
  useEffect(() => { if (debouncedOrgId !== organizationId) update({ organizationId: debouncedOrgId || undefined }); }, [debouncedOrgId]);
  useEffect(() => { if (debouncedIp !== ipFilter) update({ ip: debouncedIp || undefined }); }, [debouncedIp]);
  useEffect(() => { if (debouncedAuditSearch !== auditSearch) update({ auditSearch: debouncedAuditSearch || undefined }); }, [debouncedAuditSearch]);

  useEffect(() => {
    if (chatModelId || userId || organizationId || ipFilter || minDuration) setShowAdvanced(true);
  }, []);

  // Fetch tag keys for project
  useEffect(() => {
    if (!projectId) { setTagKeys([]); return; }
    fetch(`/api/projects/${encodeURIComponent(projectId)}`, { headers: { 'X-API-Key': apiKey } })
      .then(r => r.json())
      .then(d => setTagKeys(d.tagKeys || []))
      .catch(() => setTagKeys([]));
  }, [apiKey, projectId]);

  // === Fetch request logs ===
  const requestQueryKey = useMemo(() =>
    JSON.stringify({ search, level, method, minDuration, onlyErrors, statusCodeFilter, pathFilter, chatModelId, userId, organizationId, ipFilter, requestIdParam, pageFromUrl, limitFromUrl, projectId }),
    [search, level, method, minDuration, onlyErrors, statusCodeFilter, pathFilter, chatModelId, userId, organizationId, ipFilter, requestIdParam, pageFromUrl, limitFromUrl, projectId]
  );

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageFromUrl));
      params.set('limit', String(limitFromUrl));
      if (search) params.set('search', search);
      if (level) params.set('level', level);
      if (method) params.set('method', method);
      if (minDuration) params.set('minDuration', minDuration);
      if (onlyErrors) params.set('onlyErrors', 'true');
      if (statusCodeFilter) params.set('statusCode', statusCodeFilter);
      if (pathFilter) params.set('path', pathFilter);
      if (chatModelId) params.set('chatModelId', chatModelId);
      if (userId) params.set('userId', userId);
      if (organizationId) params.set('organizationId', organizationId);
      if (ipFilter) params.set('ip', ipFilter);
      if (requestIdParam) params.set('requestId', requestIdParam);
      if (projectId) params.set('projectId', projectId);

      const res = await fetch(`/api/logs?${params.toString()}`, { headers: { 'X-API-Key': apiKey } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();

      if (data.mode === 'trace') {
        setTraceData(data); setGroups([]); setTotal(0); setPages(1);
      } else {
        setGroups(data.groups); setTotal(data.total); setPages(data.pages); setTraceData(null);
      }
    } catch (err: any) {
      toast({ title: 'Failed to load logs', description: err.message, status: 'error', duration: 3000 });
    } finally {
      setLoading(false);
    }
  }, [requestQueryKey, apiKey]);

  // === Fetch audit logs ===
  const auditQueryKey = useMemo(() =>
    JSON.stringify({ auditLogType, auditStatus, auditSearch, pageFromUrl, limitFromUrl, projectId, activeTags }),
    [auditLogType, auditStatus, auditSearch, pageFromUrl, limitFromUrl, projectId, activeTags]
  );

  const fetchAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageFromUrl));
      params.set('limit', String(limitFromUrl));
      if (projectId) params.set('projectId', projectId);
      if (auditLogType) params.set('logType', auditLogType);
      if (auditStatus) params.set('status', auditStatus);
      if (auditSearch) params.set('search', auditSearch);
      // Add active tag filters
      for (const [k, v] of Object.entries(activeTags)) {
        params.set(`tag.${k}`, v);
      }

      const res = await fetch(`/api/audit/logs?${params.toString()}`, { headers: { 'X-API-Key': apiKey } });
      if (!res.ok) throw new Error(`${res.status}`);
      const data: AuditLogsResponse = await res.json();
      setAuditLogs(data.logs);
      setAuditTotal(data.total);
      setAuditPages(data.pages);
    } catch (err: any) {
      toast({ title: 'Failed to load audit logs', description: err.message, status: 'error', duration: 3000 });
    } finally {
      setAuditLoading(false);
    }
  }, [auditQueryKey, apiKey]);

  // Auto-fetch based on active tab
  useEffect(() => {
    if (activeTab === 'requests') fetchLogs();
    else if (activeTab === 'audit') fetchAuditLogs();
  }, [activeTab, fetchLogs, fetchAuditLogs]);

  useEffect(() => {
    if (autoRefresh && activeTab === 'requests') intervalRef.current = setInterval(() => fetchLogs(), 5000);
    if (autoRefresh && activeTab === 'audit') intervalRef.current = setInterval(() => fetchAuditLogs(), 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, activeTab, fetchLogs, fetchAuditLogs]);

  useEffect(() => {
    if (expandedId && groups.length > 0 && !groups.find(g => g.requestId === expandedId)) setExpandedId(null);
  }, [groups, expandedId]);

  const activeFilterCount = [search, level, method, minDuration, onlyErrors, statusCodeFilter, pathFilter, chatModelId, userId, organizationId, ipFilter].filter(Boolean).length;
  const hasAdvancedFilters = !!(chatModelId || userId || organizationId || ipFilter || minDuration);
  const isTraceMode = !!requestIdParam && !!traceData;

  const clearAllFilters = () => {
    setSearchInput(''); setPathInput(''); setMinDurationInput('');
    setChatModelIdInput(''); setUserIdInput(''); setOrgIdInput('');
    setIpInput(''); setAuditSearchInput('');
    setActiveTags({});
    clear();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <VStack spacing={4} align="stretch">
      {/* Tab bar */}
      <Flex justify="space-between" align="center" wrap="wrap" gap={3}>
        <HStack bg={tabBg} borderRadius="14px" p="3px" spacing={1}>
          {[
            { key: 'requests' as TabType, label: 'Request Logs', icon: FaStream },
            { key: 'audit' as TabType, label: 'Audit Logs', icon: FaHistory },
            { key: 'report' as TabType, label: 'AI Report', icon: FaFileAlt },
          ].map(tab => (
            <Button
              key={tab.key} size="sm" variant="ghost"
              bg={activeTab === tab.key ? activeTabBg : 'transparent'}
              color={activeTab === tab.key ? activeTabColor : inactiveTabColor}
              borderRadius="11px" fontWeight={activeTab === tab.key ? '600' : '400'} fontSize="13px"
              leftIcon={<Icon as={tab.icon} w={3} h={3} />}
              onClick={() => { setActiveTab(tab.key); update({ tab: tab.key === 'requests' ? undefined : tab.key }, false); }}
              _hover={{ bg: activeTab === tab.key ? activeTabBg : hoverTabBg }}
              boxShadow={activeTab === tab.key ? 'sm' : 'none'} px={4}
            >
              {tab.label}
            </Button>
          ))}
        </HStack>

        {(activeTab === 'requests' || activeTab === 'audit') && (
          <HStack spacing={3}>
            {!isTraceMode && (
              <HStack spacing={2}>
                <Switch size="sm" colorScheme="green" isChecked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} />
                <Text fontSize="xs" color={mutedText}>{autoRefresh ? 'Live' : 'Auto'}</Text>
              </HStack>
            )}
            <IconButton
              aria-label="Refresh" size="sm" variant="outline" borderRadius="10px"
              icon={(loading || auditLoading) ? <Spinner size="xs" /> : <FaSync />}
              onClick={() => activeTab === 'requests' ? fetchLogs() : fetchAuditLogs()}
              isDisabled={loading || auditLoading}
            />
          </HStack>
        )}
      </Flex>

      {/* ================================================================ */}
      {/* REQUEST LOGS TAB */}
      {/* ================================================================ */}
      {activeTab === 'requests' && !isTraceMode && (
        <Text fontSize="sm" color={mutedText} mt={-2}>
          {total.toLocaleString()} requests &middot; grouped by requestId
          {projectId && <Badge ml={2} colorScheme="brand" fontSize="10px" borderRadius="full" variant="subtle">project</Badge>}
        </Text>
      )}

      {activeTab === 'report' && <AIReportContent apiKey={apiKey} projectId={projectId} />}

      {/* Trace mode */}
      {activeTab === 'requests' && isTraceMode && traceData && (
        <VStack spacing={3} align="stretch">
          <Flex align="center" gap={3}>
            <Button size="sm" variant="ghost" leftIcon={<FaArrowLeft />} borderRadius="10px" onClick={() => update({ requestId: undefined })}>Back</Button>
            <Text fontSize="sm" fontFamily="mono" color={mutedText}>Request {traceData.requestId}</Text>
            <Badge borderRadius="full">{traceData.entries.length} entries</Badge>
          </Flex>
          <Box bg={filterBg} borderWidth="1px" borderColor={borderColor} borderRadius="16px" overflow="hidden">
            {traceData.entries.map((entry, idx) => (
              <InnerLogEntry key={idx} entry={entry} isLast={idx === traceData.entries.length - 1} />
            ))}
          </Box>
        </VStack>
      )}

      {/* Request logs grouped mode */}
      {activeTab === 'requests' && !isTraceMode && (
        <>
          <Box bg={filterBg} borderWidth="1px" borderColor={borderColor} borderRadius="18px" p={4}>
            <Flex gap={3} wrap="wrap" align="end">
              <InputGroup maxW="250px">
                <InputLeftElement pointerEvents="none"><Icon as={FaSearch} color="gray.400" /></InputLeftElement>
                <Input placeholder="Search..." value={searchInput} onChange={(e) => setSearchInput(e.target.value)} size="sm" borderRadius="12px" />
              </InputGroup>
              <Input placeholder="Path..." value={pathInput} onChange={(e) => setPathInput(e.target.value)} size="sm" maxW="180px" borderRadius="12px" />
              <Select placeholder="Level" value={level} onChange={(e) => update({ level: e.target.value || undefined })} size="sm" maxW="110px" borderRadius="12px">
                <option value="info">info</option><option value="warn">warn</option><option value="error">error</option>
              </Select>
              <Select placeholder="Method" value={method} onChange={(e) => update({ method: e.target.value || undefined })} size="sm" maxW="110px" borderRadius="12px">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
              </Select>
              <Select placeholder="Status" value={statusCodeFilter} onChange={(e) => update({ statusCode: e.target.value || undefined })} size="sm" maxW="110px" borderRadius="12px">
                <option value="2xx">2xx</option><option value="3xx">3xx</option><option value="4xx">4xx</option><option value="5xx">5xx</option>
              </Select>
              <Button size="sm" variant={onlyErrors ? 'solid' : 'outline'} colorScheme={onlyErrors ? 'red' : 'gray'} borderRadius="12px"
                leftIcon={<FaExclamationTriangle />} onClick={() => update({ onlyErrors: onlyErrors ? undefined : 'true' })}>Errors</Button>
              <Button size="sm" variant={showAdvanced ? 'solid' : 'outline'} colorScheme={hasAdvancedFilters ? 'brand' : 'gray'} borderRadius="12px"
                leftIcon={<FaFilter />} onClick={() => setShowAdvanced(!showAdvanced)}>
                {hasAdvancedFilters ? `+${[chatModelId, userId, organizationId, ipFilter, minDuration].filter(Boolean).length}` : 'More'}
              </Button>
              {activeFilterCount > 0 && (
                <HStack spacing={2}>
                  <Badge colorScheme="brand" borderRadius="full" fontSize="xs" px={2}>{activeFilterCount}</Badge>
                  <IconButton aria-label="Clear all" icon={<FaTimes />} size="sm" variant="ghost" borderRadius="8px" onClick={clearAllFilters} />
                </HStack>
              )}
            </Flex>

            <Collapse in={showAdvanced} animateOpacity>
              <Flex gap={3} wrap="wrap" align="end" mt={3} pt={3} borderTopWidth="1px" borderColor={borderColor}>
                {[
                  { label: 'ChatModel ID', value: chatModelIdInput, set: setChatModelIdInput, ph: 'clxx...' },
                  { label: 'User ID', value: userIdInput, set: setUserIdInput, ph: 'clxx...' },
                  { label: 'Organization ID', value: orgIdInput, set: setOrgIdInput, ph: 'clxx...' },
                  { label: 'IP', value: ipInput, set: setIpInput, ph: '192.168...' },
                ].map(f => (
                  <VStack key={f.label} align="start" spacing={0.5}>
                    <Text fontSize="10px" color={mutedText} fontWeight="600" textTransform="uppercase">{f.label}</Text>
                    <Input placeholder={f.ph} value={f.value} onChange={(e) => f.set(e.target.value)} size="sm" maxW="180px" borderRadius="12px" fontFamily="mono" fontSize="xs" />
                  </VStack>
                ))}
                <VStack align="start" spacing={0.5}>
                  <Text fontSize="10px" color={mutedText} fontWeight="600" textTransform="uppercase">Min duration</Text>
                  <NumberInput size="sm" maxW="110px" min={0} value={minDurationInput} onChange={(v) => setMinDurationInput(v)}>
                    <NumberInputField placeholder="ms" borderRadius="12px" fontFamily="mono" fontSize="xs" />
                  </NumberInput>
                </VStack>
              </Flex>
            </Collapse>
          </Box>

          {/* Request blocks */}
          <Box position="relative">
            {loading && groups.length > 0 && (
              <Flex position="absolute" top={0} left={0} right={0} bottom={0} bg={overlayBg} zIndex={1} align="center" justify="center" borderRadius="16px">
                <Spinner size="md" color="brand.400" />
              </Flex>
            )}
            <VStack spacing={2} align="stretch">
              {groups.map(group => (
                <RequestBlock key={group.requestId} group={group}
                  isExpanded={expandedId === group.requestId}
                  onToggle={() => setExpandedId(expandedId === group.requestId ? null : group.requestId)}
                  onCopyLink={() => {
                    const url = `${window.location.origin}?requestId=${group.requestId}`;
                    navigator.clipboard.writeText(url);
                    toast({ title: 'Link copied', status: 'info', duration: 1500 });
                  }}
                  onFilterBy={(key, value) => {
                    if (['chatModelId', 'userId', 'organizationId', 'ip'].includes(key)) {
                      if (key === 'chatModelId') setChatModelIdInput(value);
                      if (key === 'userId') setUserIdInput(value);
                      if (key === 'organizationId') setOrgIdInput(value);
                      if (key === 'ip') setIpInput(value);
                      setShowAdvanced(true);
                    }
                    update({ [key]: value });
                  }}
                />
              ))}
              {groups.length === 0 && !loading && (
                <Flex justify="center" align="center" py={12} color={mutedText} borderWidth="1px" borderColor={borderColor} borderRadius="18px" borderStyle="dashed">
                  <VStack spacing={2}><Icon as={FaClock} w={6} h={6} opacity={0.3} /><Text fontSize="sm">No request logs found</Text></VStack>
                </Flex>
              )}
              {loading && groups.length === 0 && <Flex justify="center" py={12}><Spinner size="lg" color="brand.400" /></Flex>}
            </VStack>
          </Box>

          <Pagination currentPage={pageFromUrl} totalPages={pages} totalItems={total} itemsPerPage={limitFromUrl}
            onPageChange={(newPage) => update({ page: newPage > 1 ? String(newPage) : undefined }, false)}
            onItemsPerPageChange={(perPage) => update({ limit: String(perPage), page: undefined })}
            isLoading={loading} />
        </>
      )}

      {/* ================================================================ */}
      {/* AUDIT LOGS TAB */}
      {/* ================================================================ */}
      {activeTab === 'audit' && (
        <>
          <Text fontSize="sm" color={mutedText} mt={-2}>
            {auditTotal.toLocaleString()} audit entries
            {projectId && <Badge ml={2} colorScheme="brand" fontSize="10px" borderRadius="full" variant="subtle">project</Badge>}
          </Text>

          {/* Audit Filters */}
          <Box bg={filterBg} borderWidth="1px" borderColor={borderColor} borderRadius="18px" p={4}>
            <Flex gap={3} wrap="wrap" align="end">
              <InputGroup maxW="250px">
                <InputLeftElement pointerEvents="none"><Icon as={FaSearch} color="gray.400" /></InputLeftElement>
                <Input placeholder="Search type, error, details..." value={auditSearchInput} onChange={(e) => setAuditSearchInput(e.target.value)} size="sm" borderRadius="12px" />
              </InputGroup>
              <Input
                placeholder="Log type..."
                value={auditLogType}
                onChange={(e) => update({ logType: e.target.value || undefined })}
                size="sm" maxW="200px" borderRadius="12px" fontFamily="mono" fontSize="xs"
              />
              <Select placeholder="Status" value={auditStatus} onChange={(e) => update({ auditStatus: e.target.value || undefined })} size="sm" maxW="130px" borderRadius="12px">
                <option value="SUCCESS">SUCCESS</option>
                <option value="FAILURE">FAILURE</option>
                <option value="PENDING">PENDING</option>
                <option value="WARNING">WARNING</option>
              </Select>

              {/* Active tag filters */}
              {Object.entries(activeTags).map(([k, v]) => (
                <Tag key={k} size="sm" colorScheme="purple" variant="subtle" borderRadius="full">
                  <TagLabel fontFamily="mono" fontSize="10px">{k}: {v}</TagLabel>
                  <TagCloseButton onClick={() => {
                    const next = { ...activeTags };
                    delete next[k];
                    setActiveTags(next);
                  }} />
                </Tag>
              ))}

              {(auditLogType || auditStatus || auditSearch || Object.keys(activeTags).length > 0) && (
                <IconButton aria-label="Clear" icon={<FaTimes />} size="sm" variant="ghost" borderRadius="8px"
                  onClick={() => {
                    setAuditSearchInput('');
                    setActiveTags({});
                    update({ logType: undefined, auditStatus: undefined, auditSearch: undefined });
                  }}
                />
              )}
            </Flex>

            {/* Tag key quick-filters */}
            {tagKeys.length > 0 && (
              <Flex gap={2} mt={3} pt={3} borderTopWidth="1px" borderColor={borderColor} flexWrap="wrap" align="center">
                <Icon as={FaTag} w={3} h={3} color={mutedText} />
                <Text fontSize="10px" fontWeight="600" color={mutedText} textTransform="uppercase" mr={1}>Tags:</Text>
                {tagKeys.map(k => (
                  <Badge
                    key={k} fontSize="10px" colorScheme={activeTags[k] ? 'purple' : 'gray'}
                    variant={activeTags[k] ? 'solid' : 'outline'} borderRadius="full" cursor="pointer" px={2}
                    _hover={{ opacity: 0.8 }}
                    onClick={() => {
                      if (activeTags[k]) {
                        const next = { ...activeTags };
                        delete next[k];
                        setActiveTags(next);
                      } else {
                        const value = prompt(`Filter by tag "${k}" — enter value:`);
                        if (value) setActiveTags({ ...activeTags, [k]: value });
                      }
                    }}
                  >
                    {k}{activeTags[k] ? `: ${activeTags[k]}` : ''}
                  </Badge>
                ))}
              </Flex>
            )}
          </Box>

          {/* Audit log entries */}
          <Box position="relative">
            {auditLoading && auditLogs.length > 0 && (
              <Flex position="absolute" top={0} left={0} right={0} bottom={0} bg={overlayBg} zIndex={1} align="center" justify="center" borderRadius="16px">
                <Spinner size="md" color="brand.400" />
              </Flex>
            )}
            <VStack spacing={2} align="stretch">
              {auditLogs.map(log => (
                <AuditLogBlock
                  key={log.id} log={log}
                  isExpanded={auditExpandedId === log.id}
                  onToggle={() => setAuditExpandedId(auditExpandedId === log.id ? null : log.id)}
                  onTagClick={(k, v) => {
                    setActiveTags({ ...activeTags, [k]: v });
                  }}
                />
              ))}
              {auditLogs.length === 0 && !auditLoading && (
                <Flex justify="center" align="center" py={12} color={mutedText} borderWidth="1px" borderColor={borderColor} borderRadius="18px" borderStyle="dashed">
                  <VStack spacing={2}><Icon as={FaHistory} w={6} h={6} opacity={0.3} /><Text fontSize="sm">No audit logs found</Text></VStack>
                </Flex>
              )}
              {auditLoading && auditLogs.length === 0 && <Flex justify="center" py={12}><Spinner size="lg" color="brand.400" /></Flex>}
            </VStack>
          </Box>

          <Pagination currentPage={pageFromUrl} totalPages={auditPages} totalItems={auditTotal} itemsPerPage={limitFromUrl}
            onPageChange={(newPage) => update({ page: newPage > 1 ? String(newPage) : undefined }, false)}
            onItemsPerPageChange={(perPage) => update({ limit: String(perPage), page: undefined })}
            isLoading={auditLoading} />
        </>
      )}
    </VStack>
  );
};

export default LogsViewer;
