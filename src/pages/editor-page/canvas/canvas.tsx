import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type {
    addEdge,
    NodePositionChange,
    NodeRemoveChange,
    NodeDimensionChange,
    OnEdgesChange,
    OnNodesChange,
    NodeTypes,
    EdgeTypes,
    NodeChange,
} from '@xyflow/react';
import {
    ReactFlow,
    useEdgesState,
    useNodesState,
    Background,
    BackgroundVariant,
    MiniMap,
    Controls,
    useReactFlow,
    useKeyPress,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import equal from 'fast-deep-equal';
import type { TableNodeType } from './table-node/table-node';
import { MIN_TABLE_SIZE, TableNode } from './table-node/table-node';
import type { RelationshipEdgeType } from './relationship-edge/relationship-edge';
import { RelationshipEdge } from './relationship-edge/relationship-edge';
import { useChartDB } from '@/hooks/use-chartdb';
import {
    LEFT_HANDLE_ID_PREFIX,
    TARGET_ID_PREFIX,
} from './table-node/table-node-field';
import { Toolbar } from './toolbar/toolbar';
import { useToast } from '@/components/toast/use-toast';
import { Pencil, LayoutGrid, AlertTriangle, Magnet } from 'lucide-react';
import { Button } from '@/components/button/button';
import { useLayout } from '@/hooks/use-layout';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { Badge } from '@/components/badge/badge';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from 'react-i18next';
import type { DBTable } from '@/lib/domain/db-table';
import { shouldShowTablesBySchemaFilter } from '@/lib/domain/db-table';
import { useLocalConfig } from '@/hooks/use-local-config';
import {
    Tooltip,
    TooltipTrigger,
    TooltipContent,
} from '@/components/tooltip/tooltip';
import { MarkerDefinitions } from './marker-definitions';
import { CanvasContextMenu } from './canvas-context-menu';
import { areFieldTypesCompatible } from '@/lib/data/data-types/data-types';
import {
    calcTableHeight,
    findOverlappingTables,
    findTableOverlapping,
} from './canvas-utils';
import type { Graph } from '@/lib/graph';
import { removeVertex } from '@/lib/graph';
import type { ChartDBEvent } from '@/context/chartdb-context/chartdb-context';
import { cn, debounce, getOperatingSystem } from '@/lib/utils';
import type { DependencyEdgeType } from './dependency-edge/dependency-edge';
import { DependencyEdge } from './dependency-edge/dependency-edge';
import {
    BOTTOM_SOURCE_HANDLE_ID_PREFIX,
    TARGET_DEP_PREFIX,
    TOP_SOURCE_HANDLE_ID_PREFIX,
} from './table-node/table-node-dependency-indicator';
import { DatabaseType } from '@/lib/domain/database-type';
import { useAlert } from '@/context/alert-context/alert-context';
import { useCanvas } from '@/hooks/use-canvas';
import type { AreaNodeType } from './area-node/area-node';
import { AreaNode } from './area-node/area-node';
import type { Area } from '@/lib/domain/area';

export type EdgeType = RelationshipEdgeType | DependencyEdgeType;

export type NodeType = TableNodeType | AreaNodeType;

type AddEdgeParams = Parameters<typeof addEdge<EdgeType>>[0];

const edgeTypes: EdgeTypes = {
    'relationship-edge': RelationshipEdge,
    'dependency-edge': DependencyEdge,
};

const nodeTypes: NodeTypes = {
    table: TableNode,
    area: AreaNode,
};

const initialEdges: EdgeType[] = [];

const tableToTableNode = (
    table: DBTable,
    filteredSchemas?: string[]
): TableNodeType => ({
    id: table.id,
    type: 'table',
    position: {
        x: typeof table.x === 'number' && !isNaN(table.x) ? table.x : 0,
        y: typeof table.y === 'number' && !isNaN(table.y) ? table.y : 0,
    },
    data: {
        table,
        isOverlapping: false,
    },
    width: table.width ?? MIN_TABLE_SIZE,
    draggable: true,
    hidden: !shouldShowTablesBySchemaFilter(table, filteredSchemas),
});

const areaToAreaNode = (area: Area): AreaNodeType => ({
    id: area.id,
    type: 'area',
    position: { x: area.x, y: area.y },
    data: { area },
    width: area.width,
    height: area.height,
    zIndex: -10,
});

export interface CanvasProps {
    initialTables: DBTable[];
}

export const Canvas: React.FC<CanvasProps> = ({ initialTables }) => {
    const { getEdge, getInternalNode, getEdges, getNode } = useReactFlow();
    const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
    const [selectedRelationshipIds, setSelectedRelationshipIds] = useState<
        string[]
    >([]);
    const { toast } = useToast();
    const { t } = useTranslation();
    const {
        tables,
        areas,
        relationships,
        createRelationship,
        createDependency,
        updateTablesState,
        removeRelationships,
        removeDependencies,
        getField,
        databaseType,
        filteredSchemas,
        events,
        dependencies,
        readonly,
        removeArea,
        updateArea,
    } = useChartDB();
    const { showSidePanel } = useLayout();
    const { effectiveTheme } = useTheme();
    const { scrollAction, showDependenciesOnCanvas, showMiniMapOnCanvas } =
        useLocalConfig();
    const { showAlert } = useAlert();
    const { isMd: isDesktop } = useBreakpoint('md');
    const [highlightOverlappingTables, setHighlightOverlappingTables] =
        useState(false);
    const { reorderTables, fitView, setOverlapGraph, overlapGraph } =
        useCanvas();

    const [isInitialLoadingNodes, setIsInitialLoadingNodes] = useState(true);
    const [nodes, setNodes, onNodesChange] = useNodesState<NodeType>(
        initialTables.map((table) => {
            const node = tableToTableNode(table, filteredSchemas);
            // Ensure valid position values
            node.position = {
                x: typeof table.x === 'number' && !isNaN(table.x) ? table.x : 0,
                y: typeof table.y === 'number' && !isNaN(table.y) ? table.y : 0,
            };
            return node;
        })
    );
    const [edges, setEdges, onEdgesChange] =
        useEdgesState<EdgeType>(initialEdges);

    const [snapToGridEnabled, setSnapToGridEnabled] = useState(false);

    useEffect(() => {
        setIsInitialLoadingNodes(true);
    }, [initialTables]);

    useEffect(() => {
        const initialNodes = initialTables.map((table) =>
            tableToTableNode(table, filteredSchemas)
        );
        if (equal(initialNodes, nodes)) {
            setIsInitialLoadingNodes(false);
        }
    }, [initialTables, nodes, filteredSchemas]);

    useEffect(() => {
        if (!isInitialLoadingNodes) {
            debounce(() => {
                fitView({
                    duration: 200,
                    padding: 0.1,
                    maxZoom: 0.8,
                });
            }, 500)();
        }
    }, [isInitialLoadingNodes, fitView]);

    useEffect(() => {
        const targetIndexes: Record<string, number> = relationships.reduce(
            (acc, relationship) => {
                acc[
                    `${relationship.targetTableId}${relationship.targetFieldId}`
                ] = 0;
                return acc;
            },
            {} as Record<string, number>
        );

        const targetDepIndexes: Record<string, number> = dependencies.reduce(
            (acc, dep) => {
                acc[dep.tableId] = 0;
                return acc;
            },
            {} as Record<string, number>
        );

        setEdges([
            ...relationships.map(
                (relationship): RelationshipEdgeType => ({
                    id: relationship.id,
                    source: relationship.sourceTableId,
                    target: relationship.targetTableId,
                    sourceHandle: `${LEFT_HANDLE_ID_PREFIX}${relationship.sourceFieldId}`,
                    targetHandle: `${TARGET_ID_PREFIX}${targetIndexes[`${relationship.targetTableId}${relationship.targetFieldId}`]++}_${relationship.targetFieldId}`,
                    type: 'relationship-edge',
                    data: { relationship },
                })
            ),
            ...dependencies.map(
                (dep): DependencyEdgeType => ({
                    id: dep.id,
                    source: dep.dependentTableId,
                    target: dep.tableId,
                    sourceHandle: `${TOP_SOURCE_HANDLE_ID_PREFIX}${dep.dependentTableId}`,
                    targetHandle: `${TARGET_DEP_PREFIX}${targetDepIndexes[dep.tableId]++}_${dep.tableId}`,
                    type: 'dependency-edge',
                    data: { dependency: dep },
                    hidden:
                        !showDependenciesOnCanvas &&
                        databaseType !== DatabaseType.CLICKHOUSE,
                })
            ),
        ]);
    }, [
        relationships,
        dependencies,
        setEdges,
        showDependenciesOnCanvas,
        databaseType,
    ]);

    useEffect(() => {
        const selectedNodesIds = nodes
            .filter((node) => node.selected)
            .map((node) => node.id);

        if (equal(selectedNodesIds, selectedTableIds)) {
            return;
        }

        setSelectedTableIds(selectedNodesIds);
    }, [nodes, setSelectedTableIds, selectedTableIds]);

    useEffect(() => {
        const selectedEdgesIds = edges
            .filter((edge) => edge.selected)
            .map((edge) => edge.id);

        if (equal(selectedEdgesIds, selectedRelationshipIds)) {
            return;
        }

        setSelectedRelationshipIds(selectedEdgesIds);
    }, [edges, setSelectedRelationshipIds, selectedRelationshipIds]);

    useEffect(() => {
        const tablesSelectedEdges = getEdges()
            .filter(
                (edge) =>
                    selectedTableIds.includes(edge.source) ||
                    selectedTableIds.includes(edge.target)
            )
            .map((edge) => edge.id);

        const allSelectedEdges = [
            ...tablesSelectedEdges,
            ...selectedRelationshipIds,
        ];

        setEdges((edges) =>
            edges.map((edge): EdgeType => {
                const selected = allSelectedEdges.includes(edge.id);

                if (edge.type === 'dependency-edge') {
                    const dependencyEdge = edge as DependencyEdgeType;
                    return {
                        ...dependencyEdge,
                        data: {
                            ...dependencyEdge.data!,
                            highlighted: selected,
                        },
                        animated: selected,
                        zIndex: selected ? 1 : 0,
                    };
                } else {
                    const relationshipEdge = edge as RelationshipEdgeType;
                    return {
                        ...relationshipEdge,
                        data: {
                            ...relationshipEdge.data!,
                            highlighted: selected,
                        },
                        animated: selected,
                        zIndex: selected ? 1 : 0,
                    };
                }
            })
        );
    }, [selectedRelationshipIds, selectedTableIds, setEdges, getEdges]);
    useEffect(() => {
        setNodes((currentNodes) => {
            const updatedNodes = [
                ...tables.map((table) => {
                    const isOverlapping =
                        (overlapGraph.graph.get(table.id) ?? []).length > 0;
                    const node = tableToTableNode(table, filteredSchemas);

                    // Find existing node
                    const existingNode = currentNodes.find(
                        (n) => n.id === table.id
                    );
                    if (existingNode) {
                        // Keep position if it's valid
                        if (
                            existingNode.position &&
                            typeof existingNode.position.x === 'number' &&
                            !isNaN(existingNode.position.x) &&
                            typeof existingNode.position.y === 'number' &&
                            !isNaN(existingNode.position.y)
                        ) {
                            node.position = { ...existingNode.position };
                        }

                        // Preserve measured dimensions during drag or resize
                        if (existingNode.dragging || existingNode.resizing) {
                            node.measured = existingNode.measured;
                        }

                        // Preserve selection state
                        node.selected = existingNode.selected;

                        // Preserve any ongoing drag or resize operation
                        if (existingNode.dragging) node.dragging = true;
                        if (existingNode.resizing) node.resizing = true;
                    }

                    return {
                        ...node,
                        data: {
                            ...node.data,
                            isOverlapping,
                            highlightOverlappingTables,
                        },
                    };
                }),
                ...areas.map(areaToAreaNode),
            ];
            return updatedNodes;
        });
    }, [
        tables,
        areas,
        setNodes,
        filteredSchemas,
        overlapGraph.lastUpdated,
        overlapGraph.graph,
        highlightOverlappingTables,
    ]);

    const prevFilteredSchemas = useRef<string[] | undefined>(undefined);
    useEffect(() => {
        if (!equal(filteredSchemas, prevFilteredSchemas.current)) {
            debounce(() => {
                const overlappingTablesInDiagram = findOverlappingTables({
                    tables: tables.filter((table) =>
                        shouldShowTablesBySchemaFilter(table, filteredSchemas)
                    ),
                });
                setOverlapGraph(overlappingTablesInDiagram);
                fitView({
                    duration: 500,
                    padding: 0.1,
                    maxZoom: 0.8,
                });
            }, 500)();
            prevFilteredSchemas.current = filteredSchemas;
        }
    }, [filteredSchemas, fitView, tables, setOverlapGraph]);

    const onConnectHandler = useCallback(
        async (params: AddEdgeParams) => {
            if (
                params.sourceHandle?.startsWith?.(
                    TOP_SOURCE_HANDLE_ID_PREFIX
                ) ||
                params.sourceHandle?.startsWith?.(
                    BOTTOM_SOURCE_HANDLE_ID_PREFIX
                )
            ) {
                const tableId = params.target;
                const dependentTableId = params.source;

                createDependency({
                    tableId,
                    dependentTableId,
                });

                return;
            }

            const sourceTableId = params.source;
            const targetTableId = params.target;
            const sourceFieldId = params.sourceHandle?.split('_')?.pop() ?? '';
            const targetFieldId = params.targetHandle?.split('_')?.pop() ?? '';
            const sourceField = getField(sourceTableId, sourceFieldId);
            const targetField = getField(targetTableId, targetFieldId);

            if (!sourceField || !targetField) {
                return;
            }

            if (
                !areFieldTypesCompatible(
                    sourceField.type,
                    targetField.type,
                    databaseType
                )
            ) {
                toast({
                    title: 'Field types are not compatible',
                    variant: 'destructive',
                    description:
                        'Relationships can only be created between compatible field types',
                });
                return;
            }

            createRelationship({
                sourceTableId,
                targetTableId,
                sourceFieldId,
                targetFieldId,
            });
        },
        [createRelationship, createDependency, getField, toast, databaseType]
    );

    const onEdgesChangeHandler: OnEdgesChange<EdgeType> = useCallback(
        (changes) => {
            let changesToApply = changes;

            if (readonly) {
                changesToApply = changesToApply.filter(
                    (change) => change.type !== 'remove'
                );
            }

            const removeChanges: NodeRemoveChange[] = changesToApply.filter(
                (change) => change.type === 'remove'
            ) as NodeRemoveChange[];

            const edgesToRemove = removeChanges
                .map((change) => getEdge(change.id) as EdgeType | undefined)
                .filter((edge) => !!edge);

            const relationshipsToRemove: string[] = (
                edgesToRemove.filter(
                    (edge) => edge?.type === 'relationship-edge'
                ) as RelationshipEdgeType[]
            ).map((edge) => edge?.data?.relationship?.id as string);

            const dependenciesToRemove: string[] = (
                edgesToRemove.filter(
                    (edge) => edge?.type === 'dependency-edge'
                ) as DependencyEdgeType[]
            ).map((edge) => edge?.data?.dependency?.id as string);

            if (relationshipsToRemove.length > 0) {
                removeRelationships(relationshipsToRemove);
            }

            if (dependenciesToRemove.length > 0) {
                removeDependencies(dependenciesToRemove);
            }

            return onEdgesChange(changesToApply);
        },
        [
            getEdge,
            onEdgesChange,
            removeRelationships,
            removeDependencies,
            readonly,
        ]
    );

    const updateOverlappingGraphOnChanges = useCallback(
        ({
            positionChanges,
            sizeChanges,
        }: {
            positionChanges: NodePositionChange[];
            sizeChanges: NodeDimensionChange[];
        }) => {
            if (positionChanges.length > 0 || sizeChanges.length > 0) {
                let newOverlappingGraph: Graph<string> = overlapGraph;

                for (const change of positionChanges) {
                    const node = getNode(change.id) as NodeType;
                    if (!node) {
                        continue;
                    }

                    if (node.type !== 'table') {
                        continue;
                    }

                    newOverlappingGraph = findTableOverlapping(
                        { node: node as TableNodeType },
                        {
                            nodes: nodes.filter(
                                (node) => !node.hidden && node.type === 'table'
                            ) as TableNodeType[],
                        },
                        newOverlappingGraph
                    );
                }

                for (const change of sizeChanges) {
                    const node = getNode(change.id) as NodeType;
                    if (!node) {
                        continue;
                    }

                    if (node.type !== 'table') {
                        continue;
                    }

                    newOverlappingGraph = findTableOverlapping(
                        { node: node as TableNodeType },
                        {
                            nodes: nodes.filter(
                                (node) => !node.hidden && node.type === 'table'
                            ) as TableNodeType[],
                        },
                        newOverlappingGraph
                    );
                }

                setOverlapGraph(newOverlappingGraph);
            }
        },
        [nodes, overlapGraph, setOverlapGraph, getNode]
    );

    const updateOverlappingGraphOnChangesDebounced = debounce(
        updateOverlappingGraphOnChanges,
        200
    );

    const findRelevantNodesChanges = useCallback(
        (changes: NodeChange<NodeType>[], type: NodeType['type']) => {
            const relevantChanges = changes.filter((change) => {
                if (
                    change.type === 'position' ||
                    change.type === 'dimensions' ||
                    change.type === 'remove'
                ) {
                    const node = getNode(change.id);
                    if (!node) {
                        return false;
                    }

                    if (node.type !== type) {
                        return false;
                    }

                    return true;
                }

                return false;
            });

            const positionChanges: NodePositionChange[] =
                relevantChanges.filter(
                    (change) => change.type === 'position' && !change.dragging
                ) as NodePositionChange[];

            const removeChanges: NodeRemoveChange[] = relevantChanges.filter(
                (change) => change.type === 'remove'
            ) as NodeRemoveChange[];

            const sizeChanges: NodeDimensionChange[] = relevantChanges.filter(
                (change) => change.type === 'dimensions' && change.resizing
            ) as NodeDimensionChange[];

            return {
                positionChanges,
                removeChanges,
                sizeChanges,
            };
        },
        [getNode]
    );
    const onNodesChangeHandler: OnNodesChange<NodeType> = useCallback(
        (changes) => {
            let changesToApply = changes.map((change) => {
                if (change.type === 'position' && change.position) {
                    // Get current node to preserve properties
                    const node = getNode(change.id);
                    const x =
                        typeof change.position.x === 'number' &&
                        !isNaN(change.position.x)
                            ? change.position.x
                            : (node?.position?.x ?? 0);
                    const y =
                        typeof change.position.y === 'number' &&
                        !isNaN(change.position.y)
                            ? change.position.y
                            : (node?.position?.y ?? 0);

                    return {
                        ...change,
                        position: { x, y },
                        // Preserve measured dimensions
                        measured: node?.measured,
                    };
                }
                return change;
            });

            if (readonly) {
                changesToApply = changesToApply.filter(
                    (change) => change.type !== 'remove'
                );
            }

            // Handle table changes
            const { positionChanges, removeChanges, sizeChanges } =
                findRelevantNodesChanges(changesToApply, 'table');

            if (
                positionChanges.length > 0 ||
                removeChanges.length > 0 ||
                sizeChanges.length > 0
            ) {
                // Skip updates if node is being dragged to reduce re-renders
                const isDragging = positionChanges.some((change) => {
                    if (change.type === 'position' && 'dragging' in change) {
                        return change.dragging;
                    }
                    return false;
                });

                if (!isDragging) {
                    updateTablesState((currentTables) => {
                        const updates = new Map();
                        positionChanges.forEach((change) => {
                            if (change.position) {
                                updates.set(change.id, {
                                    id: change.id,
                                    x: Math.round(change.position.x),
                                    y: Math.round(change.position.y),
                                });
                            }
                        });

                        return currentTables
                            .map((table) =>
                                updates.has(table.id)
                                    ? { ...table, ...updates.get(table.id) }
                                    : table
                            )
                            .filter(
                                (table) =>
                                    !removeChanges.some(
                                        (change) => change.id === table.id
                                    )
                            );
                    });

                    // Update overlapping graph only when not dragging
                    updateOverlappingGraphOnChangesDebounced({
                        positionChanges,
                        sizeChanges,
                    });
                }
            }

            // Handle area changes
            const {
                positionChanges: areaPositionChanges,
                removeChanges: areaRemoveChanges,
                sizeChanges: areaSizeChanges,
            } = findRelevantNodesChanges(changesToApply, 'area');

            if (
                areaPositionChanges.length > 0 ||
                areaRemoveChanges.length > 0 ||
                areaSizeChanges.length > 0
            ) {
                [...areaPositionChanges, ...areaSizeChanges].forEach(
                    (change) => {
                        const updateData: Partial<Area> = {};

                        if (change.type === 'position') {
                            updateData.x = change.position?.x;
                            updateData.y = change.position?.y;
                        }

                        if (change.type === 'dimensions') {
                            updateData.width = change.dimensions?.width;
                            updateData.height = change.dimensions?.height;
                        }

                        if (Object.keys(updateData).length > 0) {
                            updateArea(change.id, updateData);
                        }
                    }
                );

                areaRemoveChanges.forEach((change) => {
                    removeArea(change.id);
                });
            }

            return onNodesChange(changesToApply);
        },
        [
            onNodesChange,
            getNode,
            updateTablesState,
            updateOverlappingGraphOnChangesDebounced,
            findRelevantNodesChanges,
            readonly,
            updateArea,
            removeArea,
        ]
    );

    // Event consumer for table changes
    const eventConsumer = useCallback(
        (event: ChartDBEvent) => {
            let newOverlappingGraph: Graph<string> = overlapGraph;

            if (event.action === 'add_tables') {
                // Batch process new tables
                const newNodes = event.data.tables
                    .filter((table) => !getNode(table.id)?.dragging)
                    .map((table) => getNode(table.id))
                    .filter(
                        (node): node is TableNodeType => node?.type === 'table'
                    );

                if (newNodes.length > 0) {
                    newOverlappingGraph = newNodes.reduce(
                        (graph, node) =>
                            findTableOverlapping(
                                { node },
                                {
                                    nodes: nodes.filter(
                                        (n) => !n.hidden && n.type === 'table'
                                    ) as TableNodeType[],
                                },
                                graph
                            ),
                        overlapGraph
                    );
                    setOverlapGraph(newOverlappingGraph);
                }
            } else if (event.action === 'remove_tables') {
                newOverlappingGraph = event.data.tableIds.reduce(
                    (graph, tableId) => removeVertex(graph, tableId),
                    newOverlappingGraph
                );
                setOverlapGraph(newOverlappingGraph);
            } else if (
                event.action === 'add_field' ||
                event.action === 'remove_field'
            ) {
                const node = getNode(event.data.tableId) as TableNodeType;

                // Skip updates for dragging nodes
                if (node && !node.dragging) {
                    const measured = {
                        ...(node.measured ?? {}),
                        height: calcTableHeight(event.data.fields.length),
                    };

                    newOverlappingGraph = findTableOverlapping(
                        {
                            node: {
                                ...node,
                                measured,
                            },
                        },
                        {
                            nodes: nodes.filter(
                                (n) => !n.hidden && n.type === 'table'
                            ) as TableNodeType[],
                        },
                        overlapGraph
                    );
                    setOverlapGraph(newOverlappingGraph);

                    // Update node internals to trigger dimension change
                    setNodes((nds) =>
                        nds.map((n) => {
                            if (
                                n.id === event.data.tableId &&
                                n.type === 'table'
                            ) {
                                return {
                                    ...n,
                                    data: {
                                        ...n.data,
                                        table: n.data.table,
                                        isOverlapping: n.data.isOverlapping,
                                        measured,
                                    },
                                } as TableNodeType;
                            }
                            return n;
                        })
                    );
                }
            } else if (
                event.action === 'update_table' &&
                event.data.table.width
            ) {
                const node = getNode(event.data.id) as TableNodeType;
                if (node && !node.dragging) {
                    const measured = {
                        ...node.measured,
                        width: event.data.table.width,
                    };

                    newOverlappingGraph = findTableOverlapping(
                        {
                            node: {
                                ...node,
                                measured,
                            },
                        },
                        {
                            nodes: nodes.filter(
                                (n) => !n.hidden && n.type === 'table'
                            ) as TableNodeType[],
                        },
                        overlapGraph
                    );
                    setOverlapGraph(newOverlappingGraph);
                }
            } else if (event.action === 'load_diagram') {
                const diagramTables = event.data.diagram.tables ?? [];
                const overlappingTablesInDiagram = findOverlappingTables({
                    tables: diagramTables.filter((table) =>
                        shouldShowTablesBySchemaFilter(table, filteredSchemas)
                    ),
                });
                setOverlapGraph(overlappingTablesInDiagram);
            }
        },
        [
            overlapGraph,
            setOverlapGraph,
            getNode,
            nodes,
            setNodes,
            filteredSchemas,
        ]
    );

    events.useSubscription(eventConsumer);

    const isLoadingDOM =
        tables.length > 0 ? !getInternalNode(tables[0].id) : false;

    const showReorderConfirmation = useCallback(() => {
        showAlert({
            title: t('reorder_diagram_alert.title'),
            description: t('reorder_diagram_alert.description'),
            actionLabel: t('reorder_diagram_alert.reorder'),
            closeLabel: t('reorder_diagram_alert.cancel'),
            onAction: reorderTables,
        });
    }, [t, showAlert, reorderTables]);

    const hasOverlappingTables = useMemo(
        () =>
            Array.from(overlapGraph.graph).some(
                ([, value]) => value.length > 0
            ),
        [overlapGraph]
    );

    const pulseOverlappingTables = useCallback(() => {
        setHighlightOverlappingTables(true);
        setTimeout(() => setHighlightOverlappingTables(false), 600);
    }, []);

    const shiftPressed = useKeyPress('Shift');
    const operatingSystem = getOperatingSystem();

    return (
        <CanvasContextMenu>
            <div className="relative flex h-full" id="canvas">
                <ReactFlow
                    onlyRenderVisibleElements
                    colorMode={effectiveTheme}
                    className="canvas-cursor-default nodes-animated"
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChangeHandler}
                    onEdgesChange={onEdgesChangeHandler}
                    maxZoom={5}
                    minZoom={0.1}
                    onConnect={onConnectHandler}
                    proOptions={{
                        hideAttribution: true,
                    }}
                    fitView={false}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    defaultEdgeOptions={{
                        animated: false,
                        type: 'relationship-edge',
                    }}
                    panOnScroll={scrollAction === 'pan'}
                    snapToGrid={shiftPressed || snapToGridEnabled}
                    snapGrid={[20, 20]}
                >
                    <Controls
                        position="top-left"
                        showZoom={false}
                        showFitView={false}
                        showInteractive={false}
                        className="!shadow-none"
                    >
                        <div className="flex flex-col items-center gap-2 md:flex-row">
                            {!readonly ? (
                                <>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span>
                                                <Button
                                                    variant="secondary"
                                                    className="size-8 p-1 shadow-none"
                                                    onClick={
                                                        showReorderConfirmation
                                                    }
                                                >
                                                    <LayoutGrid className="size-4" />
                                                </Button>
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('toolbar.reorder_diagram')}
                                        </TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span>
                                                <Button
                                                    variant="secondary"
                                                    className={cn(
                                                        'size-8 p-1 shadow-none',
                                                        snapToGridEnabled ||
                                                            shiftPressed
                                                            ? 'bg-pink-600 text-white hover:bg-pink-500 dark:hover:bg-pink-700 hover:text-white'
                                                            : ''
                                                    )}
                                                    onClick={() =>
                                                        setSnapToGridEnabled(
                                                            (prev) => !prev
                                                        )
                                                    }
                                                >
                                                    <Magnet className="size-4" />
                                                </Button>
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {t('snap_to_grid_tooltip', {
                                                key:
                                                    operatingSystem === 'mac'
                                                        ? '⇧'
                                                        : 'Shift',
                                            })}
                                        </TooltipContent>
                                    </Tooltip>
                                </>
                            ) : null}

                            <div
                                className={`transition-opacity duration-300 ease-in-out ${
                                    hasOverlappingTables
                                        ? 'opacity-100'
                                        : 'opacity-0'
                                }`}
                            >
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <span>
                                            <Button
                                                variant="default"
                                                className="size-8 p-1 shadow-none"
                                                onClick={pulseOverlappingTables}
                                            >
                                                <AlertTriangle className="size-4 text-white" />
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t(
                                            'toolbar.highlight_overlapping_tables'
                                        )}
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                        </div>
                    </Controls>
                    {isLoadingDOM ? (
                        <Controls
                            position="top-center"
                            orientation="horizontal"
                            showZoom={false}
                            showFitView={false}
                            showInteractive={false}
                            className="!shadow-none"
                        >
                            <Badge
                                variant="default"
                                className="bg-pink-600 text-white"
                            >
                                {t('loading_diagram')}
                            </Badge>
                        </Controls>
                    ) : null}

                    {!isDesktop && !readonly ? (
                        <Controls
                            position="bottom-left"
                            orientation="horizontal"
                            showZoom={false}
                            showFitView={false}
                            showInteractive={false}
                            className="!shadow-none"
                        >
                            <Button
                                className="size-11 bg-pink-600 p-2 hover:bg-pink-500"
                                onClick={showSidePanel}
                            >
                                <Pencil />
                            </Button>
                        </Controls>
                    ) : null}
                    <Controls
                        position={isDesktop ? 'bottom-center' : 'top-center'}
                        orientation="horizontal"
                        showZoom={false}
                        showFitView={false}
                        showInteractive={false}
                        className="!shadow-none"
                    >
                        <Toolbar readonly={readonly} />
                    </Controls>
                    {showMiniMapOnCanvas && (
                        <MiniMap
                            nodeColor={(node) => {
                                const yPos = node.position?.y;
                                // Validate position to prevent NaN values
                                if (typeof yPos !== 'number' || isNaN(yPos)) {
                                    return '#ff0000'; // Red to indicate invalid position
                                }
                                return '#888';
                            }}
                            nodeStrokeWidth={3}
                            nodeBorderRadius={2}
                            style={{
                                width: isDesktop ? 100 : 60,
                                height: isDesktop ? 100 : 60,
                            }}
                        />
                    )}
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={16}
                        size={1}
                    />
                </ReactFlow>
                <MarkerDefinitions />
            </div>
        </CanvasContextMenu>
    );
};
