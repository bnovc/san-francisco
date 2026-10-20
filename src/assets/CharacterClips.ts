import * as THREE from 'three';

/** Build a static idle clip from a rig's rest pose when an asset only provides movement clips. */
export function bindPoseIdle(scene: THREE.Object3D, walk?: THREE.AnimationClip): THREE.AnimationClip {
  // The first walk key is a planted, arms-down stance for the current licensed
  // characters. Their bind poses are wide-armed A poses meant for rigging.
  if (walk) {
    const tracks = walk.tracks.map((track) => {
      const first = Array.from(track.values).slice(0, track.getValueSize());
      const values = [...first, ...first];
      if (track.name.endsWith('.quaternion')) return new THREE.QuaternionKeyframeTrack(track.name, [0, 1], values);
      return new THREE.VectorKeyframeTrack(track.name, [0, 1], values);
    });
    return new THREE.AnimationClip('idle', 1, tracks);
  }
  const tracks: THREE.KeyframeTrack[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Bone)) return;
    const p = o.position, q = o.quaternion, s = o.scale;
    tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.position`, [0, 1], [p.x, p.y, p.z, p.x, p.y, p.z]));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, [0, 1], [q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w]));
    tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.scale`, [0, 1], [s.x, s.y, s.z, s.x, s.y, s.z]));
  });
  return new THREE.AnimationClip('idle', 1, tracks);
}
