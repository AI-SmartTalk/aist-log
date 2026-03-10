import { useState, useEffect, useCallback } from 'react';
import {
  Box, Flex, HStack, VStack, Text, Input, Button, IconButton,
  useColorModeValue, useColorMode, Tooltip, Badge, Spinner,
  InputGroup, InputLeftElement, Icon, Modal, ModalOverlay, ModalContent,
  ModalHeader, ModalBody, ModalFooter, ModalCloseButton, useDisclosure,
  useToast, Code,
} from '@chakra-ui/react';
import {
  FaMoon, FaSun, FaSignOutAlt, FaDatabase, FaKey, FaArrowRight,
  FaPlus, FaTrash, FaRedo, FaCopy, FaLayerGroup, FaCircle, FaCog,
} from 'react-icons/fa';
import { useApiKey } from './hooks/useApiKey';
import LogsViewer from './pages/LogsViewer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectInfo {
  id: string;
  name: string;
  slug: string;
  apiKey: string;
  createdAt: string;
  auditCount: number;
  requestCount: number;
  lastActivity: string | null;
}

// ---------------------------------------------------------------------------
// LoginScreen
// ---------------------------------------------------------------------------

function LoginScreen({ onLogin }: { onLogin: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const cardBg = useColorModeValue('white', 'rgba(255,255,255,0.04)');
  const borderColor = useColorModeValue('gray.200', 'rgba(255,255,255,0.08)');
  const inputBg = useColorModeValue('gray.50', 'rgba(255,255,255,0.04)');

  const handleLogin = useCallback(async () => {
    if (!key) return;
    setIsLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/validate', { headers: { 'X-API-Key': key } });
      if (res.ok) {
        const data = await res.json();
        if (data.valid) onLogin(key);
        else setError('Invalid API key');
      } else if (res.status === 401) {
        setError('Invalid API key');
      } else {
        setError(`Server error (${res.status})`);
      }
    } catch { setError('Cannot reach server'); }
    finally { setIsLoading(false); }
  }, [key, onLogin]);

  return (
    <Flex minH="100vh" align="center" justify="center" bg={useColorModeValue('#f5f5f7', '#0a0a0f')}>
      <Box bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="24px" p={10} w="440px" maxW="92vw"
        boxShadow={useColorModeValue('0 4px 40px rgba(0,0,0,0.06)', '0 4px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)')}>
        <VStack spacing={1} mb={8}>
          <Flex w="56px" h="56px" borderRadius="16px" align="center" justify="center" bg={useColorModeValue('brand.50', 'rgba(99,102,241,0.12)')} mb={2}>
            <Icon as={FaDatabase} w={5} h={5} color="brand.400" />
          </Flex>
          <Text fontSize="2xl" fontWeight="800" letterSpacing="-0.02em">AIST Log</Text>
          <Text fontSize="sm" color="gray.500" textAlign="center">Unified log management platform</Text>
        </VStack>
        <VStack spacing={4}>
          <InputGroup>
            <InputLeftElement pointerEvents="none" h="48px"><Icon as={FaKey} color="gray.400" w={3.5} h={3.5} /></InputLeftElement>
            <Input placeholder="Admin API key" type="password" value={key} onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()} size="lg" h="48px" borderRadius="14px" bg={inputBg}
              border="1px solid" borderColor={borderColor} _focus={{ borderColor: 'brand.400', boxShadow: '0 0 0 3px rgba(99,102,241,0.15)' }} fontSize="sm" />
          </InputGroup>
          {error && <Text fontSize="xs" color="red.400" fontWeight="500">{error}</Text>}
          <Button w="100%" size="lg" h="48px" borderRadius="14px" bg={useColorModeValue('brand.600', 'brand.500')} color="white"
            _hover={{ bg: useColorModeValue('brand.700', 'brand.400'), transform: 'translateY(-1px)' }} transition="all 0.2s"
            rightIcon={isLoading ? <Spinner size="xs" /> : <FaArrowRight />} onClick={handleLogin} isDisabled={!key || isLoading} fontWeight="600">
            Connect
          </Button>
        </VStack>
      </Box>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Project Selector + Management
// ---------------------------------------------------------------------------

function ProjectSelector({ apiKey, onSelect }: { apiKey: string; onSelect: (projectId: string | null) => void }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();
  const toast = useToast();
  const headers = { 'X-API-Key': apiKey };

  const cardBg = useColorModeValue('white', 'rgba(255,255,255,0.03)');
  const borderColor = useColorModeValue('rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)');
  const hoverBg = useColorModeValue('gray.50', 'rgba(255,255,255,0.06)');
  const mutedText = useColorModeValue('gray.500', 'gray.400');
  const inputBg = useColorModeValue('gray.50', 'rgba(255,255,255,0.04)');

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects', { headers });
      const data = await res.json();
      setProjects(data.projects || []);
    } catch {}
    setLoading(false);
  }, [apiKey]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const createProject = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const project = await res.json();
        toast({ title: 'Project created', description: `API Key: ${project.apiKey}`, status: 'success', duration: 10000, isClosable: true });
        setNewName(''); onClose(); fetchProjects();
      } else {
        const err = await res.json();
        toast({ title: 'Error', description: err.error, status: 'error', duration: 3000 });
      }
    } catch { toast({ title: 'Error', status: 'error', duration: 3000 }); }
    setCreating(false);
  };

  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete project "${name}" and all its logs?`)) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE', headers });
    toast({ title: `Project "${name}" deleted`, status: 'info', duration: 2000 });
    fetchProjects();
  };

  const regenerateKey = async (id: string) => {
    if (!confirm('Regenerate API key? The old key will stop working immediately.')) return;
    const res = await fetch(`/api/projects/${id}/regenerate-key`, { method: 'POST', headers });
    const data = await res.json();
    toast({ title: 'New API key generated', description: data.apiKey, status: 'success', duration: 10000, isClosable: true });
    fetchProjects();
  };

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: 'API key copied', status: 'info', duration: 1500 });
  };

  if (loading) {
    return (
      <Flex align="center" justify="center" py={20}>
        <VStack spacing={4}><Spinner size="lg" color="brand.400" thickness="3px" /><Text fontSize="sm" color={mutedText}>Loading projects...</Text></VStack>
      </Flex>
    );
  }

  return (
    <Flex minH="calc(100vh - 56px)" align="center" justify="center">
      <Box maxW="700px" w="100%" px={4}>
        <VStack spacing={2} mb={8} align="center">
          <Flex w="56px" h="56px" borderRadius="16px" align="center" justify="center" bg={useColorModeValue('brand.50', 'rgba(99,102,241,0.12)')} mb={1}>
            <Icon as={FaLayerGroup} w={5} h={5} color="brand.400" />
          </Flex>
          <Text fontSize="2xl" fontWeight="800" letterSpacing="-0.02em">Projects</Text>
          <Text fontSize="sm" color={mutedText}>{projects.length} project{projects.length !== 1 ? 's' : ''} configured</Text>
        </VStack>

        {/* All projects overview */}
        <Box bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="16px" p={4} mb={3}
          cursor="pointer" _hover={{ bg: hoverBg, transform: 'translateY(-1px)' }} transition="all 0.2s"
          onClick={() => onSelect(null)}>
          <Flex align="center" gap={3}>
            <Flex w="40px" h="40px" borderRadius="12px" align="center" justify="center" bg={useColorModeValue('gray.100', 'rgba(255,255,255,0.06)')} flexShrink={0}>
              <Icon as={FaLayerGroup} w={4} h={4} color={mutedText} />
            </Flex>
            <Box flex={1}>
              <Text fontSize="sm" fontWeight="600">All Projects</Text>
              <Text fontSize="xs" color={mutedText}>View all logs across projects</Text>
            </Box>
          </Flex>
        </Box>

        <VStack spacing={2} align="stretch" mb={4}>
          {projects.map(p => {
            const total = p.auditCount + p.requestCount;
            const lastStr = p.lastActivity ? new Date(p.lastActivity).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

            return (
              <Box key={p.id} bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="16px" p={4}
                cursor="pointer" _hover={{ bg: hoverBg, transform: 'translateY(-1px)' }} transition="all 0.2s"
                onClick={() => onSelect(p.id)}>
                <Flex align="center" gap={3}>
                  <Flex w="40px" h="40px" borderRadius="12px" align="center" justify="center" bg={useColorModeValue('brand.50', 'rgba(99,102,241,0.08)')} flexShrink={0}>
                    <Icon as={FaDatabase} w={4} h={4} color="brand.400" />
                  </Flex>
                  <Box flex={1} minW={0}>
                    <HStack spacing={2} mb={0.5}>
                      <Text fontSize="sm" fontWeight="600" isTruncated>{p.name}</Text>
                      <Badge fontSize="9px" colorScheme="gray" borderRadius="full" variant="outline">{p.slug}</Badge>
                    </HStack>
                    <HStack spacing={3} fontSize="xs" color={mutedText}>
                      <Text>{total.toLocaleString()} logs</Text>
                      {lastStr && <Text>Last: {lastStr}</Text>}
                    </HStack>
                  </Box>
                  <HStack spacing={1} flexShrink={0} onClick={(e) => e.stopPropagation()}>
                    <Tooltip label="Copy API key">
                      <IconButton aria-label="Copy key" icon={<FaCopy />} size="xs" variant="ghost" borderRadius="8px" onClick={() => copyKey(p.apiKey)} />
                    </Tooltip>
                    <Tooltip label="Regenerate key">
                      <IconButton aria-label="Regen key" icon={<FaRedo />} size="xs" variant="ghost" borderRadius="8px" onClick={() => regenerateKey(p.id)} />
                    </Tooltip>
                    <Tooltip label="Delete project">
                      <IconButton aria-label="Delete" icon={<FaTrash />} size="xs" variant="ghost" borderRadius="8px" colorScheme="red" onClick={() => deleteProject(p.id, p.name)} />
                    </Tooltip>
                  </HStack>
                </Flex>
                {/* Show truncated API key */}
                <Flex mt={2} align="center" gap={2}>
                  <Code fontSize="10px" borderRadius="8px" px={2} py={0.5} bg={inputBg} color={mutedText} fontFamily="mono">
                    {p.apiKey.slice(0, 12)}...{p.apiKey.slice(-6)}
                  </Code>
                </Flex>
              </Box>
            );
          })}
        </VStack>

        <Button w="100%" variant="outline" borderRadius="14px" borderStyle="dashed" py={6}
          leftIcon={<FaPlus />} onClick={onOpen} borderColor={borderColor} color={mutedText}
          _hover={{ borderColor: 'brand.400', color: 'brand.400', bg: useColorModeValue('brand.50', 'rgba(99,102,241,0.06)') }}>
          Create new project
        </Button>

        {/* Create project modal */}
        <Modal isOpen={isOpen} onClose={onClose} isCentered>
          <ModalOverlay backdropFilter="blur(8px)" />
          <ModalContent borderRadius="20px" bg={cardBg} borderWidth="1px" borderColor={borderColor}>
            <ModalHeader fontWeight="700">New Project</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <Text fontSize="sm" color={mutedText} mb={3}>
                A unique API key will be generated for this project. Use it in the SDK to send logs.
              </Text>
              <Input placeholder="Project name (e.g. aismarttalk, chatbot-front)" value={newName}
                onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createProject()}
                borderRadius="12px" bg={inputBg} />
            </ModalBody>
            <ModalFooter gap={2}>
              <Button variant="ghost" onClick={onClose} borderRadius="12px">Cancel</Button>
              <Button colorScheme="brand" onClick={createProject} isLoading={creating} isDisabled={!newName.trim()} borderRadius="12px">Create</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Box>
    </Flex>
  );
}

// ---------------------------------------------------------------------------
// Main App
// ---------------------------------------------------------------------------

export default function App() {
  const { apiKey, setApiKey, clearApiKey } = useApiKey();
  const [selectedProject, setSelectedProject] = useState<string | null | undefined>(undefined); // undefined = show picker
  const { colorMode, toggleColorMode } = useColorMode();
  const toast = useToast();

  const headerBg = useColorModeValue('rgba(255,255,255,0.8)', 'rgba(10,10,15,0.85)');
  const borderColor = useColorModeValue('rgba(0,0,0,0.06)', 'rgba(255,255,255,0.06)');
  const mutedText = useColorModeValue('gray.500', 'gray.400');

  const [projectName, setProjectName] = useState<string>('All Projects');
  const [validatingKey, setValidatingKey] = useState(() => !!apiKey);
  // Track whether the key has been successfully validated this session
  const [keyValidated, setKeyValidated] = useState(false);

  // Validate stored key on app load
  useEffect(() => {
    if (!apiKey) { setValidatingKey(false); return; }
    fetch('/api/auth/validate', { headers: { 'X-API-Key': apiKey } })
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          if (data.valid) {
            setKeyValidated(true);
          } else {
            clearApiKey(); setSelectedProject(undefined);
          }
        } else {
          clearApiKey(); setSelectedProject(undefined);
        }
      })
      .catch(() => {
        // Network error — clear key to prevent access with unverified credentials
        clearApiKey(); setSelectedProject(undefined);
      })
      .finally(() => setValidatingKey(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Global 401 interceptor — auto-logout on invalid/expired key
  useEffect(() => {
    if (!apiKey) return;
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      if (res.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
        // Don't auto-logout during login attempt
        if (!url.includes('/api/auth/validate')) {
          clearApiKey();
          setKeyValidated(false);
          setSelectedProject(undefined);
          toast({ title: 'Session expired', description: 'Please log in again.', status: 'warning', duration: 3000 });
        }
      }
      return res;
    };
    return () => { window.fetch = originalFetch; };
  }, [apiKey, clearApiKey, toast]);

  // Fetch project name when selected
  useEffect(() => {
    if (selectedProject === undefined || selectedProject === null) {
      setProjectName('All Projects');
      return;
    }
    fetch(`/api/projects/${selectedProject}`, { headers: { 'X-API-Key': apiKey } })
      .then(r => {
        if (!r.ok) throw new Error('not ok');
        return r.json();
      })
      .then(d => setProjectName(d.name || 'Project'))
      .catch(() => {});
  }, [selectedProject, apiKey]);

  if (validatingKey) {
    return (
      <Flex minH="100vh" align="center" justify="center" bg={useColorModeValue('#f5f5f7', '#0a0a0f')}>
        <VStack spacing={4}><Spinner size="lg" color="brand.400" thickness="3px" /><Text fontSize="sm" color={mutedText}>Validating session...</Text></VStack>
      </Flex>
    );
  }

  // Handle login: store key + mark as validated
  const handleAppLogin = useCallback((key: string) => {
    setApiKey(key);
    setKeyValidated(true);
  }, [setApiKey]);

  // Show login screen if no key or key not validated
  if (!apiKey || !keyValidated) return <LoginScreen onLogin={handleAppLogin} />;

  const showPicker = selectedProject === undefined;

  return (
    <Box minH="100vh" bg={useColorModeValue('#f5f5f7', '#0a0a0f')}>
      {/* Header */}
      <Flex as="header" px={6} py={3} bg={headerBg} borderBottomWidth="1px" borderColor={borderColor}
        align="center" justify="space-between" position="sticky" top={0} zIndex={10} backdropFilter="blur(20px)">
        <HStack spacing={3}>
          <Icon as={FaDatabase} w={4} h={4} color="brand.400" />
          <Text fontWeight="700" fontSize="md" letterSpacing="-0.01em">AIST Log</Text>
          {!showPicker && (
            <>
              <Box w="1px" h="18px" bg={borderColor} />
              <HStack spacing={2} cursor="pointer" px={2} py={1} borderRadius="8px"
                _hover={{ bg: useColorModeValue('gray.100', 'rgba(255,255,255,0.06)') }}
                onClick={() => setSelectedProject(undefined)}>
                <Icon as={FaLayerGroup} w={3} h={3} color={mutedText} />
                <Text fontSize="sm" fontWeight="500" color={mutedText}>{projectName}</Text>
              </HStack>
            </>
          )}
        </HStack>
        <HStack spacing={2}>
          {!showPicker && (
            <Tooltip label="Projects">
              <IconButton aria-label="Projects" size="sm" variant="ghost" borderRadius="10px"
                icon={<FaCog />} onClick={() => setSelectedProject(undefined)} />
            </Tooltip>
          )}
          <Tooltip label={colorMode === 'dark' ? 'Light mode' : 'Dark mode'}>
            <IconButton aria-label="Theme" size="sm" variant="ghost" borderRadius="10px"
              icon={colorMode === 'dark' ? <FaSun /> : <FaMoon />} onClick={toggleColorMode} />
          </Tooltip>
          <Tooltip label="Logout">
            <IconButton aria-label="Logout" size="sm" variant="ghost" borderRadius="10px"
              icon={<FaSignOutAlt />} onClick={() => { clearApiKey(); setKeyValidated(false); setSelectedProject(undefined); }} />
          </Tooltip>
        </HStack>
      </Flex>

      {showPicker ? (
        <ProjectSelector apiKey={apiKey} onSelect={(id) => setSelectedProject(id)} />
      ) : (
        <Box maxW="1400px" mx="auto" px={{ base: 3, md: 6 }} py={5}>
          <LogsViewer apiKey={apiKey} projectId={selectedProject} />
        </Box>
      )}
    </Box>
  );
}
