import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";

const server = new McpServer({
  name: "risa3d-mcp",
  version: "1.0.0"
});

// ---- Helpers ----

// Quote-aware tokenizer: treats anything inside "..." (including internal
// spaces from RISA's fixed-width padding) as a single token.
function tokenize(line) {
  const tokens = [];
  let i = 0;
  const len = line.length;
  while (i < len) {
    while (i < len && /\s/.test(line[i])) i++;
    if (i >= len) break;
    if (line[i] === '"') {
      let j = i + 1;
      while (j < len && line[j] !== '"') j++;
      tokens.push(line.substring(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < len && !/\s/.test(line[j])) j++;
      tokens.push(line.substring(i, j));
      i = j;
    }
  }
  return tokens;
}

// Strips quotes and trims padding whitespace from a token
function clean(token) {
  return (token || "").replace(/"/g, "").trim();
}

// Parses the [NODES] section into an ORDERED array (order matters - members
// reference nodes by their 1-based position in this list, not by label).
function parseNodesOrdered(content) {
  const match = content.match(/\[NODES\] <\d+>([\s\S]*?)\[END_NODES\]/);
  if (!match) return [];
  return match[1].trim().split("\n").filter(l => l.trim()).map(line => {
    const t = tokenize(line);
    return { label: clean(t[0]), x: parseFloat(t[1]), y: parseFloat(t[2]), z: parseFloat(t[3]) };
  });
}

// Parses [.MEMBERS_MAIN_DATA] and resolves i/j node indices to labels + coords
// using the ordered node list. Member line format:
//   Label, Type(category), Size, iNodeIndex(1-based), jNodeIndex(1-based), ...
function parseMembersResolved(content, nodesOrdered) {
  const match = content.match(/\[\.MEMBERS_MAIN_DATA\] <\d+>([\s\S]*?)\[\.END_MEMBERS_MAIN_DATA\]/);
  if (!match) return [];
  return match[1].trim().split("\n").filter(l => l.trim()).map(line => {
    const t = tokenize(line);
    const label = clean(t[0]);
    const type = clean(t[1]);
    const size = clean(t[2]);
    const iIdx = parseInt(t[3], 10);
    const jIdx = parseInt(t[4], 10);
    const iNodeObj = nodesOrdered[iIdx - 1];
    const jNodeObj = nodesOrdered[jIdx - 1];
    return {
      label, type, size,
      iNodeIndex: iIdx,
      jNodeIndex: jIdx,
      iNode: iNodeObj ? iNodeObj.label : null,
      jNode: jNodeObj ? jNodeObj.label : null,
      iCoord: iNodeObj || null,
      jCoord: jNodeObj || null
    };
  });
}

function distance3D(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Tool 1: Read and summarize a .r3d file
server.tool(
  "read_risa_model",
  { filePath: z.string().describe("Full path to the .r3d file") },
  async ({ filePath }) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");

      const nodeMatch = content.match(/\[NODES\] <(\d+)>/);
      const memberMatch = content.match(/\[MEMBERS_MAIN_DATA\] <(\d+)>/);
      const plateMatch = content.match(/\[PLATES\] <(\d+)>/);

      const titleMatch = content.match(/\[\.\.MODEL_TITLE\] <1>\s*\n([^\n]+)/);
      const companyMatch = content.match(/\[\.\.COMPANY_NAME\] <1>\s*\n([^\n]+)/);
      const designerMatch = content.match(/\[\.\.DESIGNER_NAME\] <1>\s*\n([^\n]+)/);

      const summary = {
        title: titleMatch ? clean(titleMatch[1]) : "Unknown",
        company: companyMatch ? clean(companyMatch[1]) : "Unknown",
        designer: designerMatch ? clean(designerMatch[1]) : "Unknown",
        nodeCount: nodeMatch ? parseInt(nodeMatch[1]) : 0,
        memberCount: memberMatch ? parseInt(memberMatch[1]) : 0,
        plateCount: plateMatch ? parseInt(plateMatch[1]) : 0,
        fileSizeKB: Math.round(fs.statSync(filePath).size / 1024)
      };

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error reading file: ${err.message}` }]
      };
    }
  }
);

// Tool 2: List all members in a .r3d file
server.tool(
  "list_members",
  { filePath: z.string().describe("Full path to the .r3d file") },
  async ({ filePath }) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const nodesOrdered = parseNodesOrdered(content);

      if (nodesOrdered.length === 0) {
        return { content: [{ type: "text", text: "No nodes found - cannot resolve member connectivity." }] };
      }

      const members = parseMembersResolved(content, nodesOrdered);
      if (members.length === 0) {
        return { content: [{ type: "text", text: "No members found in this file." }] };
      }

      const output = members.map(m => ({
        label: m.label,
        type: m.type,
        size: m.size,
        iNode: m.iNode || `(invalid index ${m.iNodeIndex})`,
        jNode: m.jNode || `(invalid index ${m.jNodeIndex})`
      }));

      return {
        content: [{
          type: "text",
          text: `Found ${output.length} members:\n` + JSON.stringify(output, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

// Tool 3: List all nodes
server.tool(
  "list_nodes",
  { filePath: z.string().describe("Full path to the .r3d file") },
  async ({ filePath }) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const nodes = parseNodesOrdered(content);

      if (nodes.length === 0) {
        return { content: [{ type: "text", text: "No nodes found in this file." }] };
      }

      return {
        content: [{
          type: "text",
          text: `Found ${nodes.length} nodes:\n` + JSON.stringify(nodes, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

// Tool 4: List load combinations
server.tool(
  "list_load_combinations",
  { filePath: z.string().describe("Full path to the .r3d file") },
  async ({ filePath }) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");

      const lcMatch = content.match(/\[LOAD_COMBINATIONS\] <\d+>([\s\S]*?)\[END_LOAD_COMBINATIONS\]/);
      if (!lcMatch) {
        return { content: [{ type: "text", text: "No load combinations found in this file." }] };
      }

      const lcLines = lcMatch[1].trim().split("\n").filter(l => l.trim());
      const labels = lcLines.map(line => clean(tokenize(line)[0]));

      return {
        content: [{
          type: "text",
          text: `Found ${labels.length} load combinations:\n` + labels.join("\n")
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

// Tool 5: Get raw section of the file
server.tool(
  "get_file_section",
  {
    filePath: z.string().describe("Full path to the .r3d file"),
    sectionName: z.string().describe("Section keyword e.g. NODES, MEMBERS, MATERIAL_PROPERTIES")
  },
  async ({ filePath, sectionName }) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const regex = new RegExp(`\\[\\.?${sectionName}\\][\\s\\S]*?\\[\\.?END_${sectionName}\\]`);
      const match = content.match(regex);

      if (!match) {
        return { content: [{ type: "text", text: `Section [${sectionName}] not found in file.` }] };
      }

      return {
        content: [{ type: "text", text: match[0] }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

// Tool 6: Compare two .r3d files
server.tool(
  "compare_risa_models",
  {
    filePath1: z.string().describe("Full path to the first (original) .r3d file"),
    filePath2: z.string().describe("Full path to the second (revised) .r3d file")
  },
  async ({ filePath1, filePath2 }) => {
    try {
      const content1 = fs.readFileSync(filePath1, "utf8");
      const content2 = fs.readFileSync(filePath2, "utf8");

      const report = [];

      const parseLoadCombos = (content) => {
        const match = content.match(/\[LOAD_COMBINATIONS\] <\d+>([\s\S]*?)\[END_LOAD_COMBINATIONS\]/);
        if (!match) return new Set();
        return new Set(match[1].trim().split("\n").filter(l => l.trim()));
      };

      const parseSectionSets = (content) => {
        const sets = {};
        const regex = /\[\.HR_STEEL_SECTION_SETS\] <\d+>([\s\S]*?)\[\.END_HR_STEEL_SECTION_SETS\]/;
        const match = content.match(regex);
        if (match) {
          match[1].trim().split("\n").filter(l => l.trim()).forEach(line => {
            const t = tokenize(line);
            sets[clean(t[0])] = clean(t[2]);
          });
        }
        return sets;
      };

      // ---- NODES ----
      const nodes1 = parseNodesOrdered(content1);
      const nodes2 = parseNodesOrdered(content2);
      const nodeMap1 = {}; nodes1.forEach(n => nodeMap1[n.label] = n);
      const nodeMap2 = {}; nodes2.forEach(n => nodeMap2[n.label] = n);
      const allNodeLabels = new Set([...Object.keys(nodeMap1), ...Object.keys(nodeMap2)]);

      const nodesAdded = [], nodesRemoved = [], nodesMoved = [];
      allNodeLabels.forEach(label => {
        if (!nodeMap1[label]) { nodesAdded.push(label); }
        else if (!nodeMap2[label]) { nodesRemoved.push(label); }
        else {
          const n1 = nodeMap1[label], n2 = nodeMap2[label];
          const dx = Math.abs(n1.x - n2.x), dy = Math.abs(n1.y - n2.y), dz = Math.abs(n1.z - n2.z);
          if (dx > 0.001 || dy > 0.001 || dz > 0.001) {
            nodesMoved.push(`${label}: (${n1.x},${n1.y},${n1.z}) → (${n2.x},${n2.y},${n2.z})`);
          }
        }
      });

      report.push("=== NODE CHANGES ===");
      report.push(`Nodes added: ${nodesAdded.length > 0 ? nodesAdded.join(", ") : "None"}`);
      report.push(`Nodes removed: ${nodesRemoved.length > 0 ? nodesRemoved.join(", ") : "None"}`);
      report.push(`Nodes moved: ${nodesMoved.length > 0 ? nodesMoved.join("\n  ") : "None"}`);

      // ---- MEMBERS ----
      const members1raw = parseMembersResolved(content1, nodes1);
      const members2raw = parseMembersResolved(content2, nodes2);
      const members1 = {}; members1raw.forEach(m => members1[m.label] = m);
      const members2 = {}; members2raw.forEach(m => members2[m.label] = m);
      const allMemberLabels = new Set([...Object.keys(members1), ...Object.keys(members2)]);

      const membersAdded = [], membersRemoved = [], sizeChanged = [], connectivityChanged = [];
      allMemberLabels.forEach(label => {
        if (!members1[label]) { membersAdded.push(label); }
        else if (!members2[label]) { membersRemoved.push(label); }
        else {
          const m1 = members1[label], m2 = members2[label];
          if (m1.size !== m2.size || m1.type !== m2.type) {
            sizeChanged.push(`${label}: ${m1.type}/${m1.size} → ${m2.type}/${m2.size}`);
          }
          if (m1.iNode !== m2.iNode || m1.jNode !== m2.jNode) {
            connectivityChanged.push(`${label}: (${m1.iNode}-${m1.jNode}) → (${m2.iNode}-${m2.jNode})`);
          }
        }
      });

      report.push("\n=== MEMBER CHANGES ===");
      report.push(`Members added: ${membersAdded.length > 0 ? membersAdded.join(", ") : "None"}`);
      report.push(`Members removed: ${membersRemoved.length > 0 ? membersRemoved.join(", ") : "None"}`);
      report.push(`Type/Size changes: ${sizeChanged.length > 0 ? "\n  " + sizeChanged.join("\n  ") : "None"}`);
      report.push(`Connectivity changes: ${connectivityChanged.length > 0 ? "\n  " + connectivityChanged.join("\n  ") : "None"}`);

      // ---- SECTION SETS (best effort) ----
      const sets1 = parseSectionSets(content1);
      const sets2 = parseSectionSets(content2);
      const allSetLabels = new Set([...Object.keys(sets1), ...Object.keys(sets2)]);

      const setsChanged = [];
      allSetLabels.forEach(label => {
        if (sets1[label] && sets2[label] && sets1[label] !== sets2[label]) {
          setsChanged.push(`${label}: ${sets1[label]} → ${sets2[label]}`);
        } else if (!sets1[label]) {
          setsChanged.push(`${label}: ADDED`);
        } else if (!sets2[label]) {
          setsChanged.push(`${label}: REMOVED`);
        }
      });

      report.push("\n=== SECTION SET CHANGES (best effort) ===");
      report.push(setsChanged.length > 0 ? setsChanged.join("\n") : "None");

      // ---- LOAD COMBINATIONS ----
      const lc1 = parseLoadCombos(content1);
      const lc2 = parseLoadCombos(content2);
      const lcAdded = [...lc2].filter(lc => !lc1.has(lc));
      const lcRemoved = [...lc1].filter(lc => !lc2.has(lc));

      report.push("\n=== LOAD COMBINATION CHANGES ===");
      report.push(`Added: ${lcAdded.length} combination(s)`);
      report.push(`Removed: ${lcRemoved.length} combination(s)`);

      const totalChanges = nodesAdded.length + nodesRemoved.length + nodesMoved.length +
        membersAdded.length + membersRemoved.length + sizeChanged.length + connectivityChanged.length +
        setsChanged.length + lcAdded.length + lcRemoved.length;

      report.unshift(`RISA-3D Model Comparison\nFile 1: ${filePath1}\nFile 2: ${filePath2}\nTotal changes detected: ${totalChanges}\n`);

      return {
        content: [{ type: "text", text: report.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error comparing files: ${err.message}` }]
      };
    }
  }
);

// Tool 7: Export member schedule as CSV
server.tool(
  "export_member_schedule",
  { filePath: z.string().describe("Full path to the .r3d file") },
  async ({ filePath }) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const nodesOrdered = parseNodesOrdered(content);

      if (nodesOrdered.length === 0) {
        return { content: [{ type: "text", text: "No nodes found - cannot calculate member lengths." }] };
      }

      const members = parseMembersResolved(content, nodesOrdered);
      if (members.length === 0) {
        return { content: [{ type: "text", text: "No members found in this file." }] };
      }

      const rows = ["Label,Type,Size,iNode,jNode,Length(ft)"];
      members.forEach(m => {
        const len = distance3D(m.iCoord, m.jCoord);
        const lengthStr = len !== null ? len.toFixed(2) : "N/A";
        rows.push(`${m.label},${m.type},${m.size},${m.iNode || "?"},${m.jNode || "?"},${lengthStr}`);
      });

      return {
        content: [{
          type: "text",
          text: `Member Schedule (${members.length} members) - CSV format. Copy/paste this into Excel using Data > Text to Columns with comma delimiter, or save as a .csv file:\n\n` + rows.join("\n")
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

// Tool 8: QC checker for common modeling issues
server.tool(
  "qc_check_risa_model",
  { filePath: z.string().describe("Full path to the .r3d file") },
  async ({ filePath }) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const issues = [];

      const nodesOrdered = parseNodesOrdered(content);

      // Duplicate node coordinates
      const nodeCoordMap = {};
      nodesOrdered.forEach(n => {
        const key = `${n.x},${n.y},${n.z}`;
        if (!nodeCoordMap[key]) nodeCoordMap[key] = [];
        nodeCoordMap[key].push(n.label);
      });
      const duplicateNodeGroups = Object.entries(nodeCoordMap).filter(([k, labels]) => labels.length > 1);

      issues.push("--- Duplicate Nodes (same coordinates) ---");
      if (duplicateNodeGroups.length > 0) {
        duplicateNodeGroups.forEach(([coords, labels]) => {
          issues.push(`Multiple nodes at (${coords}): ${labels.join(", ")}`);
        });
      } else {
        issues.push("None found.");
      }

      // Members
      const members = parseMembersResolved(content, nodesOrdered);
      const memberLabels = new Set();
      const duplicateMemberLabels = [];
      const missingSize = [];
      const zeroLength = [];
      const invalidNodeRefs = [];

      members.forEach(m => {
        if (memberLabels.has(m.label)) duplicateMemberLabels.push(m.label);
        memberLabels.add(m.label);

        if (!m.size) missingSize.push(m.label);

        if (!m.iNode) invalidNodeRefs.push(`${m.label}: i-node index ${m.iNodeIndex} is out of range (model has ${nodesOrdered.length} nodes)`);
        if (!m.jNode) invalidNodeRefs.push(`${m.label}: j-node index ${m.jNodeIndex} is out of range (model has ${nodesOrdered.length} nodes)`);

        if (m.iNode && m.jNode) {
          const len = distance3D(m.iCoord, m.jCoord);
          if (len !== null && len < 0.001) {
            zeroLength.push(`${m.label} (${m.iNode} = ${m.jNode})`);
          }
        }
      });

      issues.push("\n--- Duplicate Member Labels ---");
      issues.push(duplicateMemberLabels.length > 0 ? duplicateMemberLabels.join(", ") : "None found.");

      issues.push("\n--- Members With No Section Size Assigned ---");
      issues.push(missingSize.length > 0 ? missingSize.join(", ") : "None found.");

      issues.push("\n--- Zero-Length Members ---");
      issues.push(zeroLength.length > 0 ? zeroLength.join(", ") : "None found.");

      issues.push("\n--- Members Referencing Invalid Node Indices ---");
      issues.push(invalidNodeRefs.length > 0 ? invalidNodeRefs.join("\n") : "None found.");

      return {
        content: [{
          type: "text",
          text: `QC Check Report\nFile: ${filePath}\nNodes: ${nodesOrdered.length}, Members: ${members.length}\n\n` + issues.join("\n")
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
