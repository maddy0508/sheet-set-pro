import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useStore } from '@/data/store';
import {
  FLASHABLE_EDGE_KINDS,
  type FlashableEdgeKind,
  type RoofEdgeKind,
  type RoofModel,
  asRoofPlane,
  buildRoofModel,
  sheetBoundaryLines,
  suggestFlashings,
  surfaceZ,
} from '@/domain/roof3d';
import { formatAreaM2, formatMm, microToDeg } from '@/domain/units';
import { labelForFlashing } from '@/domain/material';
import { Badge, Card, Notice, Stat } from '@/ui';
import { ROOF_EDGE_CSS, ROOF_EDGE_HEX as EDGE_COLOUR, ROOF_EDGE_LABEL } from '@/ui/roofColours';
import { IconAlert, IconCheck } from '@/ui/icons';
import type { JobTabProps } from './types';

const MM = 0.001;

function vector(corner: { xMm: number; yMm: number; zMm: number }): THREE.Vector3 {
  // Plan y runs south across the page; in the scene it is depth, and height is up.
  return new THREE.Vector3(corner.xMm * MM, corner.zMm * MM, corner.yMm * MM);
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    }
  });
}

/**
 * Interactive 3D view of the measured roof.
 *
 * The scene is rebuilt from `buildRoofModel`, the same function the plan view, the flashing
 * runs and the validation use. Nothing here computes a dimension: it only draws what the
 * model says, so a shape that looks wrong on screen is wrong in the estimate too.
 */
export function ModelTab({ job, planes, flashings, computation, profile }: JobTabProps) {
  const { actions } = useStore();
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; controls: OrbitControls } | null>(null);
  const [view, setView] = useState<'3d' | 'plan'>('3d');
  const [showSheets, setShowSheets] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);

  const model = useMemo<RoofModel>(() => buildRoofModel(planes.map(asRoofPlane)), [planes]);
  const coverMm = profile?.effectiveCoverMm ?? null;
  const suggested = useMemo(() => suggestFlashings(model), [model]);
  const selected = planes.find((plane) => plane.id === selectedId) ?? null;
  const selectedSurface = model.surfaces.find((surface) => surface.id === selectedId) ?? null;

  const areaMatches = model.slopeAreaMm2 === computation.areaMm2;
  const blocking = model.issues.filter((issue) => issue.severity === 'blocking');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 460;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x0b1117, 1);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1117, 40, 140);

    scene.add(new THREE.HemisphereLight(0xdff6ff, 0x14202b, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(18, 26, 12);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x88c8ff, 0.55);
    fill.position.set(-16, 10, -18);
    scene.add(fill);

    const span = Math.max(model.bounds.maxXMm - model.bounds.minXMm, model.bounds.maxYMm - model.bounds.minYMm, 6000);
    const modelWidthM = Math.max((model.bounds.maxXMm - model.bounds.minXMm) * MM, 4);
    const modelDepthM = Math.max((model.bounds.maxYMm - model.bounds.minYMm) * MM, 4);
    const centre = new THREE.Vector3(
      ((model.bounds.minXMm + model.bounds.maxXMm) / 2) * MM,
      (model.bounds.maxZMm / 2) * MM,
      ((model.bounds.minYMm + model.bounds.maxYMm) / 2) * MM,
    );

    const gridSize = Math.ceil((span * MM) / 2) * 2 + 4;
    const grid = new THREE.GridHelper(gridSize, gridSize / 2, 0x1e2b37, 0x141d26);
    grid.position.set(centre.x, 0, centre.z);
    scene.add(grid);

    const perspective = new THREE.PerspectiveCamera(42, width / height, 0.1, 500);
    const planHalfHeight = Math.max(modelDepthM / 2, modelWidthM / 2 / (width / height)) * 1.15;
    const planCamera = new THREE.OrthographicCamera(
      -planHalfHeight * (width / height),
      planHalfHeight * (width / height),
      planHalfHeight,
      -planHalfHeight,
      0.1,
      500,
    );
    planCamera.position.set(centre.x, 60, centre.z);
    planCamera.up.set(0, 0, -1);
    planCamera.lookAt(centre);

    const activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = view === 'plan' ? planCamera : perspective;
    const controls = new OrbitControls(activeCamera, renderer.domElement);
    controls.target.copy(centre);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.minDistance = 2;
    controls.maxDistance = 120;
    if (view === 'plan') {
      controls.enableRotate = false;
      planCamera.zoom = 1;
      planCamera.updateProjectionMatrix();
    }
    perspective.position.set(centre.x + span * MM * 0.55, centre.y + span * MM * 0.95, centre.z + span * MM * 1.05);
    controls.update();

    const content = new THREE.Group();
    scene.add(content);

    for (const surface of model.surfaces) {
      const [ridgeStart, ridgeEnd, eaveEnd, eaveStart] = surface.corners;
      const positions = new Float32Array(
        [ridgeStart, ridgeEnd, eaveEnd, eaveStart].flatMap((corner) => {
          const point = vector(corner);
          return [point.x, point.y, point.z];
        }),
      );
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.computeVertexNormals();

      const isSelected = surface.id === selectedId;
      const material = new THREE.MeshStandardMaterial({
        color: isSelected ? 0x2fb9cd : 0x557a93,
        emissive: isSelected ? 0x0d3b45 : 0x000000,
        metalness: 0.22,
        roughness: 0.62,
        side: THREE.DoubleSide,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.planeId = surface.id;
      content.add(mesh);

      if (showSheets && coverMm && view === '3d') {
        const plane = planes.find((entry) => entry.id === surface.id);
        if (plane) {
          const boundaryPositions: number[] = [];
          const roofPlane = asRoofPlane(plane);
          for (const line of sheetBoundaryLines(roofPlane, coverMm)) {
            // Lift each end onto the surface so the line lies on the sheet.
            const lifted = (point: { xMm: number; yMm: number }) =>
              new THREE.Vector3(point.xMm * MM, surfaceZ(roofPlane, point.xMm, point.yMm) * MM + 0.01, point.yMm * MM);
            const from = lifted(line.from);
            const to = lifted(line.to);
            boundaryPositions.push(from.x, from.y, from.z, to.x, to.y, to.z);
          }
          if (boundaryPositions.length > 0) {
            const boundaryGeometry = new THREE.BufferGeometry();
            boundaryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(boundaryPositions, 3));
            content.add(
              new THREE.LineSegments(boundaryGeometry, new THREE.LineBasicMaterial({ color: 0x9fe8f4, transparent: true, opacity: 0.55 })),
            );
          }
        }
      }
    }

    if (showEdges) {
      for (const edge of model.edges) {
        const geometry = new THREE.BufferGeometry().setFromPoints([vector(edge.from), vector(edge.to)]);
        content.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: EDGE_COLOUR[edge.kind] })));
      }
    }

    let frame = 0;
    let downAt: { x: number; y: number } | null = null;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, activeCamera);
    };
    animate();

    const onResize = () => {
      const nextWidth = mount.clientWidth || width;
      const nextHeight = mount.clientHeight || height;
      renderer.setSize(nextWidth, nextHeight);
      perspective.aspect = nextWidth / nextHeight;
      perspective.updateProjectionMatrix();
      const nextHalfHeight = Math.max(modelDepthM / 2, modelWidthM / 2 / (nextWidth / nextHeight)) * 1.15;
      planCamera.top = nextHalfHeight;
      planCamera.bottom = -nextHalfHeight;
      planCamera.left = -nextHalfHeight * (nextWidth / nextHeight);
      planCamera.right = nextHalfHeight * (nextWidth / nextHeight);
      planCamera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(mount);

    const raycaster = new THREE.Raycaster();
    const onPointerDown = (event: PointerEvent) => {
      downAt = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!downAt) return;
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
      downAt = null;
      if (moved > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, activeCamera);
      const meshes = content.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      setSelectedId(hit ? (hit.object.userData.planeId as string) : null);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    sceneRef.current = { renderer, scene, controls };

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      disposeGroup(content);
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, [model, planes, coverMm, showSheets, showEdges, selectedId, view, resetToken]);

  const setModelFlashingRuns = () => {
    for (const run of suggested) {
      actions.upsertFlashing(job.id, run.kind, run.lengthMm, 'DERIVED');
    }
  };

  return (
    <div className="grid grid-sidebar">
      <div className="grid" style={{ gap: 16 }}>
        <Card
          title="Roof model"
          subtitle="Built from the measured planes. Drag to orbit, scroll to zoom, click a plane to select it."
          tight
          action={
            <div className="toolbar">
              <div className="pill-toggle">
                <button type="button" className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>
                  3D
                </button>
                <button type="button" className={view === 'plan' ? 'active' : ''} onClick={() => setView('plan')}>
                  Plan
                </button>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setResetToken((value) => value + 1)}>
                Reset view
              </button>
            </div>
          }
        >
          <div className="roof-stage" style={{ height: 460 }}>
            <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
            <div className="roof-toolbar">
              <button
                type="button"
                className={`btn btn-sm ${showSheets ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setShowSheets((value) => !value)}
                disabled={!coverMm || view === 'plan'}
                title={
                  view === 'plan'
                    ? 'Sheet boundaries are drawn on the 3D view'
                    : coverMm
                      ? 'Show sheet boundaries at the effective cover width'
                      : 'Select a product to show sheet boundaries'
                }
              >
                Sheets
              </button>
              <button
                type="button"
                className={`btn btn-sm ${showEdges ? 'btn-secondary' : 'btn-ghost'}`}
                onClick={() => setShowEdges((value) => !value)}
              >
                Edges
              </button>
            </div>
            <div className="roof-hint">
              {planes.length === 0
                ? 'Nothing captured yet.'
                : view === 'plan'
                  ? 'Plan view — the same geometry the model and the layout read.'
                  : `${model.surfaces.length} planes · ridge ${formatMm(model.totals.ridge)} · hips ${formatMm(model.totals.hip)}`}
            </div>
          </div>
          <div className="card-foot">
            <span className="small faint">
              Slope area {formatAreaM2(model.slopeAreaMm2)} · plan area {formatAreaM2(model.planAreaMm2)}
            </span>
            <Badge tone={areaMatches ? 'ok' : 'danger'}>
              {areaMatches ? 'Model matches the calculation' : 'Model disagrees with the calculation'}
            </Badge>
          </div>
        </Card>

        <Card title="Derived edges" subtitle="Measured along the surface, so an inclined hip is its true length" tight>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Run</th>
                  <th className="num">Model length</th>
                  <th className="num">On the job</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {FLASHABLE_EDGE_KINDS.filter((kind) => model.totals[kind] > 0).map((kind: FlashableEdgeKind) => {
                    const entered = flashings.find((flashing) => flashing.kind === kind);
                    return (
                      <tr key={kind}>
                        <td className="cell-strong">{labelForFlashing(kind)}</td>
                        <td className="num">{formatMm(model.totals[kind])}</td>
                        <td className="num">
                          {entered ? (
                            <span className={entered.lengthMm === model.totals[kind] ? '' : 'muted'}>
                              {formatMm(entered.lengthMm)} · {entered.source.toLowerCase()}
                            </span>
                          ) : (
                            <span className="faint">not captured</span>
                          )}
                        </td>
                        <td className="actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => actions.upsertFlashing(job.id, kind, model.totals[kind], 'DERIVED')}
                          >
                            Use model
                          </button>
                        </td>
                      </tr>
                  );
                })}
                {suggested.length === 0 && (
                  <tr>
                    <td colSpan={4} className="faint">
                      No edges yet — capture a plane to derive them.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card-foot">
            <span className="small faint">Derived runs replace the captured length for that type.</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={setModelFlashingRuns} disabled={suggested.length === 0}>
              Use all model runs
            </button>
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        {blocking.length > 0 && (
          <Notice tone="danger" icon={<IconAlert size={15} />}>
            <strong>The model cannot be closed</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {blocking.map((issue) => (
                <li key={`${issue.ruleId}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          </Notice>
        )}

        {planes.length === 0 ? (
          <Card title="Nothing to model" tight>
            <div className="empty">
              <strong>No roof captured</strong>
              <p>Draw the roof planes in the Roof tab and they appear here in three dimensions.</p>
            </div>
          </Card>
        ) : (
          <>
            <div className="grid grid-2">
              <Stat label="Slope area" value={formatAreaM2(model.slopeAreaMm2)} />
              <Stat label="Plan area" value={formatAreaM2(model.planAreaMm2)} />
            </div>

            <Card title={selected ? `Plane ${selected.ref}` : 'Select a plane'} subtitle={selected ? undefined : 'Click a plane in the model'}>
              {selected && selectedSurface ? (
                <dl className="kv">
                  <dt>Fall</dt>
                  <dd>{selected.fall ?? 'south'}</dd>
                  <dt>Pitch</dt>
                  <dd>{microToDeg(selected.pitchMicrodeg).toFixed(1)}°</dd>
                  <dt>Eave width</dt>
                  <dd>{formatMm(selected.widthMm)}</dd>
                  <dt>Ridge width</dt>
                  <dd>{formatMm(selectedSurface.ridgeWidthMm)}</dd>
                  <dt>Slope length</dt>
                  <dd>{formatMm(selected.lengthMm)}</dd>
                  <dt>Run / rise</dt>
                  <dd>
                    {formatMm(selectedSurface.runMm)} / {formatMm(selectedSurface.riseMm)}
                  </dd>
                  <dt>Slope area</dt>
                  <dd>{formatAreaM2(selectedSurface.slopeAreaMm2)}</dd>
                </dl>
              ) : (
                <p className="small faint">
                  Every plane in the model is drawn from its measured eave width, slope length, pitch, fall direction and ridge width.
                </p>
              )}
            </Card>

            <Card title="Edge totals" tight>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {(Object.keys(model.totals) as RoofEdgeKind[]).map((kind) => (
                      <tr key={kind}>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <span
                              style={{
                                width: 9,
                                height: 9,
                                borderRadius: 2,
                                background: ROOF_EDGE_CSS[kind],
                              }}
                            />
                            {ROOF_EDGE_LABEL[kind]}
                          </span>
                        </td>
                        <td className="num">{formatMm(model.totals[kind])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {areaMatches ? (
          <Notice tone="ok" icon={<IconCheck size={15} />}>
            <strong>One geometry.</strong> The model and the calculation read the same surfaces, so the roof on screen is the roof
            being priced.
          </Notice>
        ) : (
          <Notice tone="danger" icon={<IconAlert size={15} />}>
            <strong>Geometry mismatch.</strong> The model reports {formatAreaM2(model.slopeAreaMm2)} but the calculation uses{' '}
            {formatAreaM2(computation.areaMm2)}. Treat the estimate as unverified until this is resolved.
          </Notice>
        )}
      </div>
    </div>
  );
}

