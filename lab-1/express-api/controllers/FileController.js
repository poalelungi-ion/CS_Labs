const {AuditDocumentModel, FileModel} = require('../models/AuditFileModel');
const fs = require('fs');
const path = require('path');
const {renderFile} = require('template-file');

class FileController {

    async insertAudit(req, res, next) {
        try {
            const body = req.body;
            const filename = body.audit_filename;

            // is unique
            const found = await AuditDocumentModel.findOne({audit_filename: filename});
            if (found !== null) res.send({isSuccess: false, error: `file ${filename} already exists`});

            else {
                const string = await renderFile(path.join(__dirname, '../models/template.audit'), body);
                // console.log(string);
                fs.writeFile(path.join(__dirname, `../uploads/${filename}`), string, function (err) {
                    if (err) return res.status(500).json({isSuccess: false, error: err.message});
                    const doc = {
                        filename: filename,
                        file: {
                            content: fs.readFileSync(path.join(__dirname + '/../uploads/' + filename)),
                            content_type: 'audit'
                        }
                    };
                    const fileRecord = new FileModel(doc);
                    fileRecord.save(err => {
                        if (err) res.status(500).json({isSuccess: false, error: err.message});
                        const auditDoc = {
                            ...body,
                            audit_file: fileRecord._id,
                            audit_filename: filename
                        };
                        const auditDocumentRecord = new AuditDocumentModel(auditDoc);
                        auditDocumentRecord.save(err => {
                            if (err) res.status(500).json({isSuccess: false, error: err.message});
                            res.status(200).json({isSuccess: true});
                        });
                    });
                });
            }
        } catch (e) {
            res.status(500).json({isSuccess: false, error: e.message});
        }

    }

    async uploadFile(req, res, next) {
        const filename = req.file.originalname;
        const doc = {
            filename: filename,
            file: {
                content: fs.readFileSync(path.join(__dirname + '/../uploads/' + filename)),
                content_type: 'audit'
            }
        };

        const fileRecord = new FileModel(doc);
        fileRecord.save(err => {
            if (err) res.send(500).json({isSuccess: false, error: err.message});
            return this.parseAuditFile(req, res, next, filename, fileRecord._id);
        });
    }

    async parseAuditFile(req, res, next, filename, fileId) {
        console.log("reading file: ", filename);
        const filepath = path.join(__dirname, '/../uploads/' + filename);
        let content = fs.readFileSync(filepath, 'utf-8');
        // remove tabs && new lines
        content = content.replace(/\s+/g, ' ');

        const audit_document_general_regex = {
            audit_revision: /\# ?\$Revision\s*:(.*?)\$/g,
            audit_date: /\# ?\$Date\s*:(.*?)\$/g,
            audit_description: /\#\s*description\s*:\s*(.*?)\#/ig,
            audit_display_name: /\#\<display_name\>\s*(.*?)\s*\<\/display_name\>/ig,
            audit_check_type_os: /\<check_type:\"(.*?)\"/g,
            audit_check_type_version: /\<check_type[\s\S]*version:"(.*?)"\>/g,
            audit_group_policy: /\<group_policy\:\"(.*?)\"\>/g
        };

        // data to be saved
        const audit_document_general_data = {};
        const audit_document_specs_data = {};
        const audit_document_variables_data = [];
        const audit_document_custom_items_data = [];

        // General Audit Data
        for (let key in audit_document_general_regex) {
            try {
                let reg = audit_document_general_regex[key];
                let exec = reg.exec(content);
                audit_document_general_data[key] = exec[1];
            } catch (e) {
            }
        }

        // Audit Specifications 1:1
        try {
            const audit_specs_regex = /\#\<spec\>(.*?)\#\<\/spec\>/g;
            let exec = audit_specs_regex.exec(content);
            let audit_specs_content = exec[1];

            const audit_specs_content_regex = {
                spec_type: /\#\s*\<type\>(.*?)\s*\<\/type\>/g,
                spec_name: /\#\s*\<name\>(.*?)\s*\<\/name\>/g,
                spec_version: /\#\s*\<version\>(.*?)\s*\<\/version\>/g,
                spec_link: /\#\s*\<link\>(.*?)\s*\<\/link\>/g
            };

            for (let key in audit_specs_content_regex) {
                try {
                    let reg = audit_specs_content_regex[key];
                    let exec = reg.exec(audit_specs_content);
                    audit_document_specs_data[key] = exec[1];
                } catch (e) {
                }

            }

        } catch (e) {
        }

        // Audit Variables 1:n
        try {
            const audit_variables_regex = /\#\s*\<variable\>(.*?)\#\s*\<\/variable\>/g;
            let matches, output = [];
            while (matches = audit_variables_regex.exec(content)) {
                output.push(matches[1]);
            }

            let audit_variables_content_regex = {
                variable_name: /\#\s*\<name\>(.*?)\s*\<\/name\>/g,
                variable_default: /\#\s*\<default\>(.*?)\s*\<\/default\>/g,
                variable_description: /\#\s*\<description\>(.*?)\s*\<\/description\>/g,
                variable_info: /\#\s*\<info\>(.*?)\s*\<\/info\>/g
            };

            // over variables list
            for (let i = 0; i < output.length; i++) {
                let variable = output[i];
                let variable_data = {};
                // over variable attributes
                for (let key in audit_variables_content_regex) {
                    try {
                        let reg = audit_variables_content_regex[key];
                        let exec = reg.exec(variable);
                        variable_data[key] = exec[1];
                        reg.lastIndex = 0; // reset
                    } catch (e) {
                    }
                }
                audit_document_variables_data.push(variable_data);
            }
        } catch (e) {
        }

        // Audit Custom Items (Policies) 1:n
        try {
            const audit_custom_items_regex = /\<custom_item\>(.*?)\<\/custom_item\>/g;
            let matches, output = [];
            while (matches = audit_custom_items_regex.exec(content)) {
                output.push(matches[1]);
            }

            let audit_custom_items_data_regex = {
                policy_type: /type\s*:\s*(.*?)description/g,
                policy_description: /description\s*:\s*"(.*?)\"/g,
                policy_info: /info\s*:\s*"(.*?)\"/g,
                policy_solution: /solution\s*:\s*"(.*?)\"/g,
                policy_collection: /collection\s*:\s*"(.*?)\"/g,
                policy_fields_selector: /fieldsSelector\s*:\s*"(.*?)\"/g,
                policy_query: /query\s*:\s*"(.*?)\"/g,
                policy_reference: /reference\s*:\s*"(.*?)\"/g,
                policy_see_also: /see_also\s*:\s*"(.*?)\"/g,
                policy_value_type: /value_type\s*:\s*(.*?)\#/g,
                policy_value_data: /value_data\s*:\s*"(.*?)\"/g,
                policy_Note: /\# Note\s*:\s*(.*?)value_data/,
                policy_regex: /regex\s*:\s*"(.*?)\"/g,
                policy_expect: /expect\s*:\s*"(.*?)\"/g
            };

            // over custom items
            for (let i = 0; i < output.length; i++) {
                let custom_item = output[i];
                let custom_item_data = {};
                // over regex keys
                for (let key in audit_custom_items_data_regex) {
                    try {
                        let reg = audit_custom_items_data_regex[key];
                        let exec = reg.exec(custom_item);
                        custom_item_data[key] = exec[1];
                        reg.lastIndex = 0;
                    } catch (e) {
                        // it depends from file to file, it can be the same key with double commas / single commas
                        // from regex with double comma (") substitute with single comma (')
                        let strReg = audit_custom_items_data_regex[key].toString();
                        let singleCommaReg = strReg.split('"').join("'").slice(0, -2).substring(1);
                        try {
                            let single_comma_regex = new RegExp(singleCommaReg, 'g');
                            let found = single_comma_regex.exec(custom_item);
                            custom_item_data[key] = found[1];
                        } catch (e) {
                        }
                    }
                }
                audit_document_custom_items_data.push(custom_item_data);
            }
        } catch (e) {
        }

        // insert record in mongo
        try {
            const auditFileRecord = new AuditDocumentModel({
                ...audit_document_general_data,
                audit_specifications: audit_document_specs_data,
                audit_variables: [...audit_document_variables_data],
                audit_custom_items: [...audit_document_custom_items_data],
                audit_file: fileId,
                audit_filename: filename
            });
            auditFileRecord.save(err => {
                if (err) res.status(500).json({isSuccess: false, error: err.message});
                else res.status(200).json({isSuccess: true});
            });

        } catch (e) {
            res.status(500).json({isSuccess: false, error: e.message});
        }
    }


    async getAllFiles(req, res, next) {
        AuditDocumentModel.find({}, '-_id')
            .populate('audit_file', '-_id')
            .exec()
            .then(files => res.send({isSuccess: true, files}))
            .catch(err => res.status(500).json({isSuccess: false, error: err.message}));
    }

    async fileExistsByName(req, res, next) {
        const filename = req.params.filename;
        const found = await AuditDocumentModel.findOne({audit_filename: filename});
        if (found !== null) res.send({exists: true});
        res.send({exists: false});
    }

    async downloadFileByName(req, res, next) {
        const filename = req.params.filename;
        const filepath = path.join(__dirname + '/../uploads/' + filename);
        fs.readFile(filepath, (err, data) => {
            if (err) return next(err);
            res.setHeader('Content-Disposition', 'attachment: filename="' + '"');
            res.send(data);
        });
    }

    async deleteFileByName(req, res, next) {
        const filename = req.params.filename;
        const filepath = path.join(__dirname + '/../uploads/' + filename);
        await fs.unlinkSync(filepath);
        AuditDocumentModel.findOneAndRemove({audit_filename: filename}, (err) => {
            if (err) res.status(500).json({isSuccess: false, error: err.message});
            FileModel.findOneAndRemove({filename: filename}, (err) => {
                if (err) res.status(500).json({isSuccess: false, error: err.message});
                res.send({isSuccess: true, message: 'file was deleted'});
            });
        });
    }
}

module.exports = FileController;

