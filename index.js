import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";

const server = new McpServer({
  name: "risa3d-mcp",
  version: "1.0.0"
});

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
        title: titleMatch ? titleMatch[1].trim() : "Unknown",
        company: companyMatch ? companyMatch[1].trim() : "Unknown",
        designer: designerMatch ? designerMatch[1].trim() : "Unknown",
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

      const membersMatch = content.match(/\[\.MEMBERS_MAIN_DATA\] <\d+>([\s\S]*?)\[\.END_MEMBERS_MAIN_DATA\]/);
      if (!membersMatch) {
        return { content: [{ type: "text", text: "No members found in this file." }] };
      }

      const memberLines = membersMatch[1].trim().split("\n").filter(l => l.trim());
      const members = memberLines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          label: parts[0]?.replace(/"/g, ""),
          iNode: parts[1],
          jNode: parts[2],
          shape: parts[3]?.replace(/"/g, "")
        };
      });

      return {
        content: [{
          type: "text",
          text: `Found ${members.length} members:\n` + JSON.stringify(members, null, 2)
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

      const nodesMatch = content.match(/\[NODES\] <\d+>([\s\S]*?)\[END_NODES\]/);
      if (!nodesMatch) {
        return { content: [{ type: "text", text: "No nodes found in this file." }] };
      }

      const nodeLines = nodesMatch[1].trim().split("\n").filter(l => l.trim());
      const nodes = nodeLines.map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          label: parts[0]?.replace(/"/g, ""),
          x: parseFloat(parts[1]),
          y: parseFloat(parts[2]),
          z: parseFloat(parts[3])
        };
      });

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
      return {
        content: [{
          type: "text",
          text: `Found ${lcLines.length} load combinations:\n` + lcLines.join("\n")
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
      const regex = new RegExp(`\\[${sectionName}\\][\\s\\S]*?\\[END_${sectionName}\\]`);
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

      // --- Helper: parse nodes ---
      const parseNodes = (content) => {
        const match = content.match(/\[NODES\] <\d+>([\s\S]*?)\[END_NODES\]/);
        if (!match) return {};
        const nodes = {};
        match[1].trim().split("\n").filter(l => l.trim()).forEach(line => {
          const parts = line.trim().split(/\s+/);
          const label = parts[0]?.replace(/"/g, "");
          nodes[label] = { x: parseFloat(parts[1]), y: parseFloat(parts[2]), z: parseFloat(parts[3]) };
        });
        return nodes;
      };

      // --- Helper: parse members ---
      const parseMembers = (content) => {
        const match = content.match(/\[\.MEMBERS_MAIN_DATA\] <\d+>([\s\S]*?)\[\.END_MEMBERS_MAIN_DATA\]/);
        if (!match) return {};
        const members = {};
        match[1].trim().split("\n").filter(l => l.trim()).forEach(line => {
          const parts = line.trim().split(/\s+/);
          const label = parts[0]?.replace(/"/g, "");
          members[label] = {
            iNode: parts[1],
            jNode: parts[2],
            shape: parts[3]?.replace(/"/g, "")
          };
        });
        return members;
      };

      // --- Helper: parse load combinations ---
      const parseLoadCombos = (content) => {
        const match = content.match(/\[LOAD_COMBINATIONS\] <\d+>([\s\S]*?)\[END_LOAD_COMBINATIONS\]/);
        if (!match) return new Set();
        return new Set(match[1].trim().split("\n").filter(l => l.trim()));
      };

      // --- Helper: parse section sets ---
      const parseSectionSets = (content) => {
        const sets = {};
        const regex = /\[\.HR_STEEL_SECTION_SETS\] <\d+>([\s\S]*?)\[\.END_HR_STEEL_SECTION_SETS\]/;
        const match = content.match(regex);
        if (match) {
          match[1].trim().split("\n").filter(l => l.trim()).forEach(line => {
            const parts = line.trim().split(/\s+/);
            const label = parts[0]?.replace(/"/g, "");
            const shape = parts[2]?.replace(/"/g, "");
            sets[label] = shape;
          });
        }
        return sets;
      };

      // ---- COMPARE NODES ----
      const nodes1 = parseNodes(content1);
      const nodes2 = parseNodes(content2);
      const allNodeLabels = new Set([...Object.keys(nodes1), ...Object.keys(nodes2)]);

      const nodesAdded = [], nodesRemoved = [], nodesMoved = [];
      allNodeLabels.forEach(label => {
        if (!nodes1[label]) { nodesAdded.push(label); }
        else if (!nodes2[label]) { nodesRemoved.push(label); }
        else {
          const n1 = nodes1[label], n2 = nodes2[label];
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

      // ---- COMPARE MEMBERS ----
      const members1 = parseMembers(content1);
      const members2 = parseMembers(content2);
      const allMemberLabels = new Set([...Object.keys(members1), ...Object.keys(members2)]);

      const membersAdded = [], membersRemoved = [], membersChanged = [];
      allMemberLabels.forEach(label => {
        if (!members1[label]) { membersAdded.push(label); }
        else if (!members2[label]) { membersRemoved.push(label); }
        else {
          const m1 = members1[label], m2 = members2[label];
          if (m1.shape !== m2.shape) {
            membersChanged.push(`${label}: ${m1.shape} → ${m2.shape}`);
          }
        }
      });

      report.push("\n=== MEMBER CHANGES ===");
      report.push(`Members added: ${membersAdded.length > 0 ? membersAdded.join(", ") : "None"}`);
      report.push(`Members removed: ${membersRemoved.length > 0 ? membersRemoved.join(", ") : "None"}`);
      report.push(`Section size changes: ${membersChanged.length > 0 ? "\n  " + membersChanged.join("\n  ") : "None"}`);

      // ---- COMPARE SECTION SETS ----
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

      report.push("\n=== SECTION SET CHANGES ===");
      report.push(setsChanged.length > 0 ? setsChanged.join("\n") : "None");

      // ---- COMPARE LOAD COMBINATIONS ----
      const lc1 = parseLoadCombos(content1);
      const lc2 = parseLoadCombos(content2);
      const lcAdded = [...lc2].filter(lc => !lc1.has(lc));
      const lcRemoved = [...lc1].filter(lc => !lc2.has(lc));

      report.push("\n=== LOAD COMBINATION CHANGES ===");
      report.push(`Added: ${lcAdded.length > 0 ? lcAdded.join(", ") : "None"}`);
      report.push(`Removed: ${lcRemoved.length > 0 ? lcRemoved.join(", ") : "None"}`);

      // ---- SUMMARY ----
      const totalChanges = nodesAdded.length + nodesRemoved.length + nodesMoved.length +
        membersAdded.length + membersRemoved.length + membersChanged.length +
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

const transport = new StdioServerTransport();
await server.connect(transport);
